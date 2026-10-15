// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {TestBase} from "./TestBase.sol";
import {CipherBid} from "../src/CipherBid.sol";
import {LocalCollectible} from "../src/LocalCollectible.sol";
import {ForceETH} from "./CipherBid.t.sol";

contract Handler is TestBase {
    CipherBid public h;
    LocalCollectible public nft;
    address public seller = address(50);
    address[4] public actors = [address(51),address(52),address(53),address(54)];
    mapping(uint256 => mapping(address => uint256)) public revealCount;
    mapping(uint256 => mapping(address => uint256)) public settleCount;
    mapping(uint256 => uint256) public claimCount;
    uint256 public deposits;
    uint256 public payouts;
    uint256 public forced;
    constructor(CipherBid house,LocalCollectible collection) { h=house; nft=collection; }

    function step(uint256 seed) external {
        uint256 count=h.auctionCount();
        uint256 action=seed%9;
        address actor=actors[(seed/9)%4];
        if(count==0 || (action==0 && count<12)) {
            uint256 token=nft.mint(seller);
            vm.startPrank(seller); nft.approve(address(h),token);
            h.createAuction(address(nft),token,1 ether,5 ether,0.1 ether,block.timestamp+40,block.timestamp+80);
            vm.stopPrank(); return;
        }
        uint256 id=1+(seed/36)%count;
        CipherBid.Auction memory a=h.getAuction(id);
        CipherBid.Bid memory b=h.getBid(id,actor);
        bytes32 salt=keccak256(abi.encode(id,actor));
        uint256 amount=1 ether+(uint160(actor)%4)*1 ether;
        if(action==1 && block.timestamp<a.commitDeadline && !a.finalized && b.sequence==0) {
            vm.deal(actor,100 ether);
            bytes32 hash=h.commitmentFor(id,actor,amount,salt);
            vm.prank(actor); h.commit{value:5.1 ether}(id,hash); deposits+=5.1 ether;
        } else if(action==2) {
            vm.warp(block.timestamp+(seed/144)%45);
        } else if(action==3 && !a.finalized && block.timestamp>=a.commitDeadline && block.timestamp<a.revealDeadline && b.sequence!=0) {
            vm.prank(actor); (bool ok,)=address(h).call(abi.encodeCall(h.reveal,(id,amount,salt)));
            if(ok) ++revealCount[id][actor];
        } else if(action==4 && !a.finalized && block.timestamp>=a.revealDeadline) {
            h.finalize(id);
        } else if(action==5 && a.finalized && b.sequence!=0) {
            (bool ok,)=address(h).call(abi.encodeCall(h.settleBidder,(id,actor)));
            if(ok) ++settleCount[id][actor];
        } else if(action==6) {
            address beneficiary=(seed/144)%2==0?seller:actor;
            uint256 credit=h.credits(beneficiary);
            if(credit!=0) { vm.prank(beneficiary); h.withdraw(payable(beneficiary)); payouts+=credit; }
        } else if(action==7 && a.finalized) {
            address claimant=a.highestBidder==address(0)?seller:a.highestBidder;
            // Probe an unauthorized account, then exercise legitimate and repeated claims.
            vm.prank(address(999));
            (bool stolen,)=address(h).call(abi.encodeCall(h.claimAsset,(id,address(999))));
            yes(!stolen);
            vm.prank(claimant);
            (bool ok,)=address(h).call(abi.encodeCall(h.claimAsset,(id,claimant)));
            if(ok) ++claimCount[id];
        } else if(action==8) {
            vm.deal(address(this),1 wei); new ForceETH{value:1 wei}(payable(address(h))); ++forced;
        }
    }
}

contract CipherBidInvariantTest is TestBase {
    CipherBid h;
    LocalCollectible nft;
    Handler handler;
    address[] targets;
    function setUp() public {
        vm.warp(1000);
        h=new CipherBid(keccak256("invariant"));
        nft=new LocalCollectible();
        handler=new Handler(h,nft);
        targets.push(address(handler));
    }
    function targetContracts() public view returns(address[] memory) { return targets; }
    function invariantBackingConservationAndAuthorization() public view {
        eq(h.totalDeposited(),handler.deposits());
        eq(h.totalWithdrawn(),handler.payouts());
        eq(h.totalLiability()+h.totalWithdrawn(),h.totalDeposited());
        eq(address(h).balance,h.totalLiability()+handler.forced());
        uint256 unallocated;
        uint256 credits=h.credits(handler.seller());
        for(uint256 j; j<4; ++j) credits+=h.credits(handler.actors(j));
        eq(credits,h.totalCredits());
        for(uint256 id=1; id<=h.auctionCount(); ++id) {
            CipherBid.Auction memory a=h.getAuction(id);
            yes(handler.claimCount(id)<=1);
            eq(handler.claimCount(id),a.claimed?1:0);
            if(a.claimed) eq(nft.ownerOf(a.tokenId),a.highestBidder==address(0)?a.seller:a.highestBidder);
            else eq(nft.ownerOf(a.tokenId),address(h));
            for(uint256 j; j<4; ++j) {
                address actor=handler.actors(j);
                CipherBid.Bid memory b=h.getBid(id,actor);
                yes(handler.revealCount(id,actor)<=1 && handler.settleCount(id,actor)<=1);
                eq(handler.revealCount(id,actor),b.revealed?1:0);
                eq(handler.settleCount(id,actor),b.settled?1:0);
                if(b.sequence!=0 && !b.settled) {
                    unallocated+=a.collateral+a.bond;
                    if(a.finalized && actor==a.highestBidder) unallocated-=a.highestBid;
                }
            }
        }
        eq(unallocated+credits,h.totalLiability());
        eq(h.credits(address(handler)),0); eq(h.credits(address(999)),0);
    }
}
