// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// General disclaimer comment.
// This file is intended for experimental deployment.
contract PreprintFHEReview is SepoliaConfig {
    // Small note.
    struct EncryptedManuscript {
        uint256 id;
        euint32 encryptedTitle;
        euint32 encryptedBody;
        euint32 encryptedTopics;
        uint256 timestamp;
    }

    // Brief marker.
    struct RevealedManuscript {
        string title;
        string body;
        string topics;
        bool revealed;
    }

    // State variables.
    uint256 public manuscriptCount;
    mapping(uint256 => EncryptedManuscript) private manuscriptsEncrypted;
    mapping(uint256 => RevealedManuscript) private manuscriptsRevealed;

    // Encrypted counters by topic label (stored as ciphertexts).
    mapping(string => euint32) private encryptedTopicCounters;
    string[] private knownTopics;

    // Track decryption requests to manuscripts and topics.
    mapping(uint256 => uint256) private requestToManuscript;
    mapping(uint256 => bytes32) private requestToTopicHash;

    // Events emitted by the contract.
    event ManuscriptSubmitted(uint256 indexed id, uint256 when);
    event DecryptionRequested(uint256 indexed id);
    event ManuscriptRevealed(uint256 indexed id);
    event TopicCountDecryptionRequested(string topic);
    event TopicCountDecrypted(string topic, uint32 count);

    // Modifier placeholder for access control.
    modifier onlyAuthor(uint256 manuscriptId) {
        // Access control placeholder.
        _;
    }

    // Modifier placeholder for reviewer actions.
    modifier onlyReviewer() {
        // Reviewer gating placeholder.
        _;
    }

    // Constructor note.
    constructor() {
        // Empty constructor.
    }

    // Submit an encrypted manuscript to the system.
    function submitEncryptedManuscript(
        euint32 encryptedTitle,
        euint32 encryptedBody,
        euint32 encryptedTopics
    ) external {
        manuscriptCount += 1;
        uint256 newId = manuscriptCount;

        manuscriptsEncrypted[newId] = EncryptedManuscript({
            id: newId,
            encryptedTitle: encryptedTitle,
            encryptedBody: encryptedBody,
            encryptedTopics: encryptedTopics,
            timestamp: block.timestamp
        });

        manuscriptsRevealed[newId] = RevealedManuscript({
            title: "",
            body: "",
            topics: "",
            revealed: false
        });

        emit ManuscriptSubmitted(newId, block.timestamp);
    }

    // Request decryption for a specific manuscript.
    function requestManuscriptDecryption(uint256 manuscriptId) external onlyAuthor(manuscriptId) {
        require(!manuscriptsRevealed[manuscriptId].revealed, "Already revealed");

        EncryptedManuscript storage em = manuscriptsEncrypted[manuscriptId];
        bytes32[] memory ciphers = new bytes32[](3);
        ciphers[0] = FHE.toBytes32(em.encryptedTitle);
        ciphers[1] = FHE.toBytes32(em.encryptedBody);
        ciphers[2] = FHE.toBytes32(em.encryptedTopics);

        uint256 reqId = FHE.requestDecryption(ciphers, this.handleManuscriptDecryption.selector);
        requestToManuscript[reqId] = manuscriptId;

        emit DecryptionRequested(manuscriptId);
    }

    // Callback that receives decrypted manuscript text.
    function handleManuscriptDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 manuscriptId = requestToManuscript[requestId];
        require(manuscriptId != 0, "Bad request id");

        RevealedManuscript storage rm = manuscriptsRevealed[manuscriptId];
        require(!rm.revealed, "Already processed");

        // Verify decryption authenticity.
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode plaintexts.
        string[] memory parts = abi.decode(cleartexts, (string[]));
        rm.title = parts[0];
        rm.body = parts[1];
        rm.topics = parts[2];
        rm.revealed = true;

        // Update topic counters homomorphically if needed.
        if (!FHE.isInitialized(encryptedTopicCounters[rm.topics])) {
            encryptedTopicCounters[rm.topics] = FHE.asEuint32(0);
            knownTopics.push(rm.topics);
        }
        encryptedTopicCounters[rm.topics] = FHE.add(encryptedTopicCounters[rm.topics], FHE.asEuint32(1));

        emit ManuscriptRevealed(manuscriptId);
    }

    // Retrieve a revealed manuscript.
    function getRevealedManuscript(uint256 manuscriptId) external view returns (string memory, string memory, string memory, bool) {
        RevealedManuscript storage r = manuscriptsRevealed[manuscriptId];
        return (r.title, r.body, r.topics, r.revealed);
    }

    // Expose encrypted counter for a specific topic.
    function getEncryptedTopicCounter(string calldata topic) external view returns (euint32) {
        return encryptedTopicCounters[topic];
    }

    // Request decryption of a topic's encrypted counter.
    function requestTopicCounterDecryption(string calldata topic) external onlyReviewer {
        euint32 count = encryptedTopicCounters[topic];
        require(FHE.isInitialized(count), "Topic unknown");

        bytes32[] memory ciphers = new bytes32[](1);
        ciphers[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphers, this.handleTopicCountDecryption.selector);
        requestToTopicHash[reqId] = keccak256(abi.encodePacked(topic));

        emit TopicCountDecryptionRequested(topic);
    }

    // Callback to process decrypted topic count.
    function handleTopicCountDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 topicHash = requestToTopicHash[requestId];
        require(topicHash != bytes32(0), "Unknown topic request");

        // Verify proof.
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode count and emit event.
        uint32 count = abi.decode(cleartexts, (uint32));
        string memory topic = _topicFromHash(topicHash);
        emit TopicCountDecrypted(topic, count);
    }

    // Utility: convert bytes32 to uint256.
    function _bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    // Utility: find topic string from stored list.
    function _topicFromHash(bytes32 h) private view returns (string memory) {
        for (uint i = 0; i < knownTopics.length; i++) {
            if (keccak256(abi.encodePacked(knownTopics[i])) == h) {
                return knownTopics[i];
            }
        }
        revert("Topic not found");
    }

    // Placeholder for homomorphic addition example.
    function homomorphicIncrementTopic(string calldata topic) external {
        if (!FHE.isInitialized(encryptedTopicCounters[topic])) {
            encryptedTopicCounters[topic] = FHE.asEuint32(0);
            knownTopics.push(topic);
        }
        encryptedTopicCounters[topic] = FHE.add(encryptedTopicCounters[topic], FHE.asEuint32(1));
    }

    // Retrieve manuscript metadata.
    function getManuscriptMetadata(uint256 manuscriptId) external view returns (uint256 id, uint256 when) {
        EncryptedManuscript storage m = manuscriptsEncrypted[manuscriptId];
        return (m.id, m.timestamp);
    }

    // Administrative reset (kept intentionally simple).
    function adminResetCounters() external {
        for (uint i = 0; i < knownTopics.length; i++) {
            delete encryptedTopicCounters[knownTopics[i]];
        }
        delete knownTopics;
    }

    // Fallback functions to accept payments if needed.
    receive() external payable {}
    fallback() external payable {}
}
