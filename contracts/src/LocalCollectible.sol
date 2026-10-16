// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Intentionally unrestricted faucet for local development collectibles only.
contract LocalCollectible is ERC721 {
    uint256 public nextTokenId;
    constructor() ERC721("CipherBid Studies", "STUDY") {}

    function mint(address to) external returns (uint256 id) {
        id = ++nextTokenId;
        _safeMint(to, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string[4] memory names = ["Orbital Form", "Quiet Intersections", "Violet Assembly", "A Study in Balance"];
        string memory n = Strings.toString(id);
        string memory hue = Strings.toString((id * 57 + 220) % 360);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">',
            '<rect width="600" height="600" fill="#e9e5db"/>',
            '<g fill="none" stroke="hsl(',
            hue,
            ',35%,36%)" stroke-width="36">',
            '<ellipse cx="300" cy="300" rx="180" ry="100" transform="rotate(-45 300 300)"/>',
            '<ellipse cx="300" cy="300" rx="180" ry="100" transform="rotate(45 300 300)"/>',
            '<circle cx="300" cy="300" r="135"/></g>',
            '<text x="40" y="555" font-family="monospace" font-size="18" fill="#303028">STUDY / ',
            n,
            "</text></svg>"
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"name":"',
                        names[(id - 1) % 4],
                        '","description":"A locally minted onchain SVG collectible. Development use only.",',
                        '"image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(svg)),
                        '"}'
                    )
                )
            )
        );
    }
}
