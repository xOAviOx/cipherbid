// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function chainId(uint256) external;
}

contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function eq(uint256 a, uint256 b) internal pure { require(a == b, "uint mismatch"); }
    function eq(address a, address b) internal pure { require(a == b, "address mismatch"); }
    function yes(bool b) internal pure { require(b, "assertion failed"); }
}
