// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {TestBase} from "./TestBase.sol";
import {CipherBid} from "../src/CipherBid.sol";
import {LocalCollectible} from "../src/LocalCollectible.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract Hostile is IERC721Receiver {
    CipherBid public house;
    bool public rejectEth;
    bool public rejectNFT;
    bool public attack;
    bool public reentered;
    constructor(CipherBid h) { house = h; }
    function configure(bool eth, bool nft, bool reenter) external { rejectEth = eth; rejectNFT = nft; attack = reenter; }
    function commit(uint256 id, bytes32 hash) external payable { house.commit{value: msg.value}(id, hash); }
    function reveal(uint256 id, uint256 amount, bytes32 salt) external { house.reveal(id, amount, salt); }
    function withdraw(address payable to) external { house.withdraw(to); }
    function claim(uint256 id, address to) external { house.claimAsset(id, to); }
    receive() external payable {
        require(!rejectEth, "no ETH");
        if (attack) { (reentered,) = address(house).call(abi.encodeCall(house.withdraw, (payable(address(this))))); }
    }
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        require(!rejectNFT, "no NFT");
        if (attack) { (reentered,) = address(house).call(abi.encodeCall(house.claimAsset, (1, address(this)))); }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract ForceETH {
    constructor(address payable to) payable { selfdestruct(to); }
}

contract CipherBidTest is TestBase {
    CipherBid h;
    LocalCollectible nft;
    address seller = address(11);
    address alice = address(12);
    address bob = address(13);
    address carol = address(14);
    bytes32 salt = bytes32(uint256(123));
    uint256 constant C = 5 ether;
    uint256 constant B = 0.1 ether;
    uint256 constant R = 1 ether;

    function setUp() public {
        vm.warp(1000);
        h = new CipherBid(keccak256("test deployment"));
        nft = new LocalCollectible();
        vm.deal(alice, 1000 ether); vm.deal(bob, 1000 ether); vm.deal(carol, 1000 ether);
        nft.mint(seller);
        vm.startPrank(seller);
        nft.approve(address(h), 1);
        h.createAuction(address(nft), 1, R, C, B, 1100, 1200);
        vm.stopPrank();
    }
    function commitAs(address who, uint256 amount) internal {
        bytes32 hash = h.commitmentFor(1, who, amount, salt);
        vm.prank(who); h.commit{value: C+B}(1, hash);
    }
    function revealAs(address who, uint256 amount) internal { vm.prank(who); h.reveal(1, amount, salt); }
    function finish() internal { vm.warp(1200); h.finalize(1); }

    function testAtomicEscrowAndApproval() public {
        eq(nft.ownerOf(1), address(h));
        nft.mint(seller);
        vm.prank(seller); vm.expectRevert();
        h.createAuction(address(nft), 2, R, C, B, 1100, 1200);
        eq(nft.ownerOf(2), seller); eq(h.auctionCount(), 1);
    }
    function testInvalidBoundsAndUnintendedNFT() public {
        nft.mint(seller);
        vm.startPrank(seller); nft.approve(address(h), 2);
        vm.expectRevert(CipherBid.InvalidParameters.selector); h.createAuction(address(nft), 2, 0, C, B, 1100, 1200);
        vm.expectRevert(CipherBid.InvalidParameters.selector); h.createAuction(address(nft), 2, C+1, C, B, 1100, 1200);
        vm.expectRevert(CipherBid.InvalidParameters.selector); h.createAuction(address(nft), 2, R, C, 0, 1100, 1200);
        vm.expectRevert(CipherBid.InvalidParameters.selector); h.createAuction(address(nft), 2, R, C, B, 1000, 1200);
        vm.expectRevert(CipherBid.InvalidParameters.selector); h.createAuction(address(nft), 2, R, C, B, 1100, 1100);
        vm.expectRevert(CipherBid.UnexpectedNFT.selector); nft.safeTransferFrom(seller, address(h), 2);
        vm.stopPrank();
        eq(nft.ownerOf(2), seller);
    }
    function testExactCollateralDuplicateSellerZero() public {
        vm.startPrank(alice);
        vm.expectRevert(CipherBid.IncorrectDeposit.selector); h.commit{value: C}(1, salt);
        vm.expectRevert(CipherBid.IncorrectDeposit.selector); h.commit{value: C+B+1}(1, salt);
        vm.expectRevert(CipherBid.InvalidCommitment.selector); h.commit{value: C+B}(1, 0);
        h.commit{value: C+B}(1, salt);
        vm.expectRevert(CipherBid.AlreadyCommitted.selector); h.commit{value: C+B}(1, salt);
        vm.stopPrank();
        vm.deal(seller, C+B); vm.prank(seller);
        vm.expectRevert(CipherBid.Unauthorized.selector); h.commit{value: C+B}(1, salt);
    }
    function testDomainSeparationAndCopiedCommitment() public {
        bytes32 hash = h.commitmentFor(1, alice, R, salt);
        yes(hash == keccak256(abi.encode(block.chainid, address(h), uint256(1), alice, R, salt)));
        yes(hash != h.commitmentFor(2, alice, R, salt));
        yes(hash != h.commitmentFor(1, bob, R, salt));
        CipherBid other = new CipherBid(salt);
        yes(hash != other.commitmentFor(1, alice, R, salt));
        uint256 chain = block.chainid; vm.chainId(chain+1);
        yes(hash != h.commitmentFor(1, alice, R, salt)); vm.chainId(chain);
        commitAs(alice, R);
        vm.prank(bob); h.commit{value:C+B}(1, hash);
        vm.warp(1100); vm.prank(bob); vm.expectRevert(CipherBid.InvalidReveal.selector); h.reveal(1, R, salt);
        revealAs(alice, R);
    }
    function testInvalidRevealThenValidAndDuplicate() public {
        commitAs(alice, 2 ether); vm.warp(1100);
        vm.startPrank(alice);
        vm.expectRevert(CipherBid.InvalidReveal.selector); h.reveal(1, 3 ether, salt);
        vm.expectRevert(CipherBid.InvalidReveal.selector); h.reveal(1, 2 ether, bytes32(uint256(124)));
        vm.expectRevert(CipherBid.InvalidReveal.selector); h.reveal(1, R-1, salt);
        vm.expectRevert(CipherBid.InvalidReveal.selector); h.reveal(1, C+1, salt);
        h.reveal(1, 2 ether, salt);
        vm.expectRevert(CipherBid.AlreadyRevealed.selector); h.reveal(1, 2 ether, salt);
        vm.stopPrank();
    }
    function testPhaseBoundaries() public {
        commitAs(alice, R); commitAs(bob, C);
        vm.warp(1099); vm.prank(alice); vm.expectRevert(CipherBid.WrongPhase.selector); h.reveal(1,R,salt);
        vm.warp(1100); vm.prank(carol); vm.expectRevert(CipherBid.WrongPhase.selector); h.commit{value:C+B}(1,salt);
        revealAs(alice, R);
        vm.warp(1199); vm.expectRevert(CipherBid.WrongPhase.selector); h.finalize(1);
        revealAs(bob, C);
        vm.warp(1200); vm.prank(carol); vm.expectRevert(CipherBid.WrongPhase.selector); h.reveal(1,R,salt);
        h.finalize(1);
    }
    function testTieReverseRevealOrder() public {
        commitAs(alice, 3 ether); commitAs(bob, 3 ether);
        vm.warp(1100); revealAs(bob, 3 ether); revealAs(alice, 3 ether);
        finish(); eq(h.getAuction(1).highestBidder, alice); eq(h.getAuction(1).highestSequence, 1);
    }
    function testAcceptanceAccountingAndPermissionlessSettlement() public {
        commitAs(alice, 3 ether); commitAs(bob, 2 ether); commitAs(carol, 4 ether);
        vm.warp(1100); revealAs(bob, 2 ether); revealAs(alice, 3 ether); finish();
        eq(h.credits(seller), 3 ether);
        vm.startPrank(address(99));
        h.settleBidder(1,alice); h.settleBidder(1,bob); h.settleBidder(1,carol);
        vm.expectRevert(CipherBid.AlreadySettled.selector); h.settleBidder(1,carol);
        vm.expectRevert(CipherBid.NoCredit.selector); h.withdraw(payable(address(99)));
        vm.expectRevert(CipherBid.Unauthorized.selector); h.claimAsset(1,address(99));
        vm.stopPrank();
        eq(h.credits(alice), 2.1 ether); eq(h.credits(bob), 5.1 ether);
        eq(h.credits(carol), 5 ether); eq(h.credits(seller), 3.1 ether);
        eq(h.totalCredits(), 15.3 ether); eq(h.totalLiability(), 15.3 ether);
        address[4] memory people = [alice,bob,carol,seller];
        for(uint256 i; i<4; ++i) { vm.prank(people[i]); h.withdraw(payable(people[i])); }
        eq(h.totalLiability(),0); eq(address(h).balance,0); eq(h.totalWithdrawn(),h.totalDeposited());
        vm.prank(alice); h.claimAsset(1,bob); eq(nft.ownerOf(1),bob);
        vm.prank(alice); vm.expectRevert(CipherBid.AlreadyClaimed.selector); h.claimAsset(1,alice);
        vm.prank(alice); vm.expectRevert(CipherBid.NoCredit.selector); h.withdraw(payable(alice));
        vm.expectRevert(CipherBid.AlreadyFinalized.selector); h.finalize(1);
    }
    function testNoCommitmentsNoSaleAndCancellation() public {
        vm.prank(bob); vm.expectRevert(CipherBid.Unauthorized.selector); h.cancel(1);
        vm.prank(seller); h.cancel(1);
        vm.prank(seller); h.claimAsset(1,bob); eq(nft.ownerOf(1),bob);
        vm.expectRevert(CipherBid.WrongPhase.selector); h.commit{value:C+B}(1,salt);
    }
    function testEmptyAuctionFinalize() public {
        finish(); eq(h.getAuction(1).highestBidder,address(0));
        vm.prank(seller); h.claimAsset(1,seller); eq(nft.ownerOf(1),seller);
    }
    function testNoValidRevealAndCancellationRestrictions() public {
        commitAs(alice,R);
        vm.prank(seller); vm.expectRevert(CipherBid.WrongPhase.selector); h.cancel(1);
        finish(); h.settleBidder(1,alice);
        eq(h.credits(alice),C); eq(h.credits(seller),B);
        vm.prank(seller); h.claimAsset(1,seller);
    }
    function testExpiredCancellationAndEarlyActions() public {
        vm.expectRevert(CipherBid.WrongPhase.selector); h.settleBidder(1,alice);
        vm.prank(seller); vm.expectRevert(CipherBid.WrongPhase.selector); h.claimAsset(1,seller);
        vm.warp(1100); vm.prank(seller); vm.expectRevert(CipherBid.WrongPhase.selector); h.cancel(1);
    }
    function testHostileRecipientAndAlternateRecipients() public {
        Hostile hostile = new Hostile(h);
        vm.deal(address(this),C+B);
        hostile.commit{value:C+B}(1,h.commitmentFor(1,address(hostile),R,salt));
        vm.warp(1100); hostile.reveal(1,R,salt); finish(); h.settleBidder(1,address(hostile));
        hostile.configure(true,true,false);
        vm.expectRevert(CipherBid.TransferFailed.selector); hostile.withdraw(payable(address(hostile)));
        eq(h.credits(address(hostile)),C+B-R);
        vm.expectRevert(); hostile.claim(1,address(hostile)); yes(!h.getAuction(1).claimed);
        vm.prank(seller); h.withdraw(payable(seller));
        hostile.withdraw(payable(bob)); hostile.claim(1,bob);
        eq(nft.ownerOf(1),bob); eq(h.totalLiability(),0);
    }
    function testReentrantRecipients() public {
        Hostile hostile = new Hostile(h);
        vm.deal(address(this),C+B);
        hostile.commit{value:C+B}(1,h.commitmentFor(1,address(hostile),R,salt));
        vm.warp(1100); hostile.reveal(1,R,salt); finish(); h.settleBidder(1,address(hostile));
        hostile.configure(false,false,true);
        hostile.withdraw(payable(address(hostile))); yes(!hostile.reentered());
        hostile.claim(1,address(hostile)); yes(!hostile.reentered());
        eq(nft.ownerOf(1),address(hostile)); eq(h.credits(address(hostile)),0);
    }
    function testFuzzRefundConservation(uint96 rawA,uint96 rawB,bool reverse) public {
        uint256 a = R+uint256(rawA)%(C-R+1);
        uint256 b = R+uint256(rawB)%(C-R+1);
        commitAs(alice,a); commitAs(bob,b); vm.warp(1100);
        if(reverse) { revealAs(bob,b); revealAs(alice,a); } else { revealAs(alice,a); revealAs(bob,b); }
        finish(); h.settleBidder(1,alice); h.settleBidder(1,bob);
        eq(h.totalCredits(),2*(C+B)); eq(h.credits(seller),a>=b?a:b);
        eq(h.getAuction(1).highestBidder,a>=b?alice:bob);
    }
    function testForcedETHIsSurplus() public {
        commitAs(alice,R); vm.deal(address(this),1 ether);
        new ForceETH{value:1 ether}(payable(address(h)));
        eq(address(h).balance,h.totalLiability()+1 ether);
    }
    function testFinalizeBoundedRegardlessOfBidderCount() public {
        for(uint256 i=100; i<300; ++i) { vm.deal(address(uint160(i)),C+B); vm.prank(address(uint160(i))); h.commit{value:C+B}(1,salt); }
        vm.warp(1200); uint256 before = gasleft(); h.finalize(1);
        yes(before-gasleft()<100000);
    }
}
