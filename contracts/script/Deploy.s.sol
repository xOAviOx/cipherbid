// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {CipherBid} from "../src/CipherBid.sol";
import {LocalCollectible} from "../src/LocalCollectible.sol";

interface DeployVm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envBytes32(string calldata) external returns (bytes32);
}

/// @dev Optional Forge deployment entry point. The documented pnpm command also exports metadata.
contract Deploy {
    DeployVm constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        require(block.chainid == 31338, "local chain only");
        bytes32 identity = vm.envBytes32("CIPHERBID_DEPLOYMENT_ID");
        vm.startBroadcast();
        new CipherBid(identity);
        new LocalCollectible();
        vm.stopBroadcast();
    }
}
