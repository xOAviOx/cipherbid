// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Local first-price sealed-bid auctions. No administrator or rescue authority.
contract CipherBid is IERC721Receiver, ReentrancyGuard {
    struct Auction {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 reserve;
        uint256 collateral;
        uint256 bond;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 commitmentCount;
        uint256 highestBid;
        address highestBidder;
        uint256 highestSequence;
        bool finalized;
        bool cancelled;
        bool claimed;
    }

    struct Bid {
        bytes32 commitment;
        uint256 sequence;
        uint256 amount;
        bool revealed;
        bool settled;
    }

    error UnknownAuction();
    error InvalidParameters();
    error WrongPhase();
    error Unauthorized();
    error AlreadyCommitted();
    error InvalidCommitment();
    error IncorrectDeposit();
    error InvalidReveal();
    error AlreadyRevealed();
    error AlreadyFinalized();
    error AlreadySettled();
    error AlreadyClaimed();
    error NoCredit();
    error TransferFailed();
    error UnexpectedNFT();

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, address indexed nft, uint256 tokenId);
    event Committed(uint256 indexed auctionId, address indexed bidder, bytes32 commitment, uint256 sequence);
    event Revealed(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event Finalized(uint256 indexed auctionId, address indexed winner, uint256 winningBid);
    event Cancelled(uint256 indexed auctionId);
    event BidderSettled(uint256 indexed auctionId, address indexed bidder, uint256 refund, uint256 forfeitedBond);
    event Withdrawn(address indexed beneficiary, address indexed recipient, uint256 amount);
    event AssetClaimed(uint256 indexed auctionId, address indexed claimant, address indexed recipient);

    bytes32 public immutable deploymentId;
    uint256 public auctionCount;
    mapping(uint256 => Auction) private auctions;
    mapping(uint256 => mapping(address => Bid)) private bids;
    mapping(address => uint256) public credits;

    // All deposited ETH remains a liability until withdrawn, including unallocated deposits.
    uint256 public totalLiability;
    uint256 public totalCredits;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    address private expectedNFT;
    address private expectedFrom;
    uint256 private expectedToken;
    bool private escrowReceived;

    constructor(bytes32 identity) {
        if (identity == bytes32(0)) revert InvalidParameters();
        deploymentId = identity;
    }

    function getAuction(uint256 id) public view returns (Auction memory) {
        _auction(id);
        return auctions[id];
    }

    function getBid(uint256 id, address bidder) external view returns (Bid memory) {
        _auction(id);
        return bids[id][bidder];
    }

    function commitmentFor(uint256 id, address bidder, uint256 amount, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, bidder, amount, salt));
    }

    function createAuction(
        address nft, uint256 tokenId, uint256 reserve, uint256 collateral,
        uint256 bond, uint256 commitDeadline, uint256 revealDeadline
    ) external nonReentrant returns (uint256 id) {
        if (
            reserve == 0 || reserve > collateral || bond == 0 || collateral > type(uint256).max - bond
                || commitDeadline <= block.timestamp || revealDeadline <= commitDeadline
                || nft.code.length == 0
        ) revert InvalidParameters();
        if (!IERC165(nft).supportsInterface(type(IERC721).interfaceId)) revert InvalidParameters();
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert Unauthorized();

        id = ++auctionCount;
        Auction storage a = auctions[id];
        a.seller = msg.sender;
        a.nft = nft;
        a.tokenId = tokenId;
        a.reserve = reserve;
        a.collateral = collateral;
        a.bond = bond;
        a.commitDeadline = commitDeadline;
        a.revealDeadline = revealDeadline;

        expectedNFT = nft;
        expectedFrom = msg.sender;
        expectedToken = tokenId;
        escrowReceived = false;
        IERC721(nft).safeTransferFrom(msg.sender, address(this), tokenId);
        if (!escrowReceived || IERC721(nft).ownerOf(tokenId) != address(this)) revert UnexpectedNFT();
        delete expectedNFT;
        delete expectedFrom;
        delete expectedToken;
        delete escrowReceived;
        emit AuctionCreated(id, msg.sender, nft, tokenId);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external returns (bytes4)
    {
        if (
            msg.sender != expectedNFT || from != expectedFrom || tokenId != expectedToken
                || operator != address(this) || escrowReceived
        ) revert UnexpectedNFT();
        escrowReceived = true;
        return IERC721Receiver.onERC721Received.selector;
    }

    function commit(uint256 id, bytes32 commitment) external payable {
        Auction storage a = _auction(id);
        if (a.cancelled || block.timestamp >= a.commitDeadline) revert WrongPhase();
        if (msg.sender == a.seller) revert Unauthorized();
        Bid storage b = bids[id][msg.sender];
        if (b.sequence != 0) revert AlreadyCommitted();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (msg.value != a.collateral + a.bond) revert IncorrectDeposit();
        b.commitment = commitment;
        b.sequence = ++a.commitmentCount;
        totalLiability += msg.value;
        totalDeposited += msg.value;
        emit Committed(id, msg.sender, commitment, b.sequence);
    }

    function reveal(uint256 id, uint256 amount, bytes32 salt) external {
        Auction storage a = _auction(id);
        if (a.cancelled || block.timestamp < a.commitDeadline || block.timestamp >= a.revealDeadline) revert WrongPhase();
        Bid storage b = bids[id][msg.sender];
        if (b.revealed) revert AlreadyRevealed();
        if (
            b.sequence == 0 || amount < a.reserve || amount > a.collateral
                || commitmentFor(id, msg.sender, amount, salt) != b.commitment
        ) revert InvalidReveal();
        b.revealed = true;
        b.amount = amount;
        if (amount > a.highestBid || (amount == a.highestBid && b.sequence < a.highestSequence)) {
            a.highestBid = amount;
            a.highestBidder = msg.sender;
            a.highestSequence = b.sequence;
        }
        emit Revealed(id, msg.sender, amount);
    }

    /// @notice O(1), no bidder iteration and no external interaction.
    function finalize(uint256 id) external {
        Auction storage a = _auction(id);
        if (a.finalized) revert AlreadyFinalized();
        if (block.timestamp < a.revealDeadline) revert WrongPhase();
        a.finalized = true;
        if (a.highestBidder != address(0)) _credit(a.seller, a.highestBid);
        emit Finalized(id, a.highestBidder, a.highestBid);
    }

    /// @notice Anyone can allocate another bidder's refund, but cannot change its beneficiary.
    function settleBidder(uint256 id, address bidder) external {
        Auction storage a = _auction(id);
        if (!a.finalized) revert WrongPhase();
        Bid storage b = bids[id][bidder];
        if (b.sequence == 0) revert InvalidCommitment();
        if (b.settled) revert AlreadySettled();
        b.settled = true;
        uint256 refund = a.collateral;
        uint256 forfeited;
        if (b.revealed) {
            refund += a.bond;
            if (bidder == a.highestBidder) refund -= a.highestBid;
        } else {
            forfeited = a.bond;
            _credit(a.seller, forfeited);
        }
        _credit(bidder, refund);
        emit BidderSettled(id, bidder, refund, forfeited);
    }

    function cancel(uint256 id) external {
        Auction storage a = _auction(id);
        if (msg.sender != a.seller) revert Unauthorized();
        if (a.finalized || block.timestamp >= a.commitDeadline || a.commitmentCount != 0) revert WrongPhase();
        a.cancelled = true;
        a.finalized = true;
        emit Cancelled(id);
    }

    function withdraw(address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidParameters();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        credits[msg.sender] = 0;
        totalCredits -= amount;
        totalLiability -= amount;
        totalWithdrawn += amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, recipient, amount);
    }

    function claimAsset(uint256 id, address recipient) external nonReentrant {
        Auction storage a = _auction(id);
        if (!a.finalized) revert WrongPhase();
        address claimant = a.highestBidder == address(0) ? a.seller : a.highestBidder;
        if (msg.sender != claimant) revert Unauthorized();
        if (a.claimed) revert AlreadyClaimed();
        if (recipient == address(0) || recipient == address(this)) revert InvalidParameters();
        a.claimed = true;
        IERC721(a.nft).safeTransferFrom(address(this), recipient, a.tokenId);
        emit AssetClaimed(id, claimant, recipient);
    }

    function _credit(address beneficiary, uint256 amount) private {
        credits[beneficiary] += amount;
        totalCredits += amount;
    }

    function _auction(uint256 id) private view returns (Auction storage a) {
        a = auctions[id];
        if (a.seller == address(0)) revert UnknownAuction();
    }
}
