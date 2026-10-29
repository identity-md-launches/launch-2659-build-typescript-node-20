import { parseAbi, parseAbiItem } from "viem";

// Signatures copied from the published SqueekCore V3 / SqueekMining v6 ABIs
// (https://docs.squeekchain.com/assets/abi/) and the Quickstart.

export const identityAbi = parseAbi([
  "function implementationCodeAddress() view returns (address)",
  "function implementationCodeVersion() view returns (uint64)",
  "function implementationStorageLayoutDigest() view returns (bytes32)",
  "function owner() view returns (address)",
]);

export const graphAbi = parseAbi([
  "function core() view returns (address)",
  "function mining() view returns (address)",
  "function collectionPolicy(uint8 collection) view returns ((address nft, uint16 maxSupply, uint8 maximumLevel, (uint64 weight, uint64 cooldownBlocks)[] levels))",
  "function configuration() view returns ((bytes32 streamId, uint64 genesisTimestamp, uint64 roundDuration, uint64 maxWorkPerRound, uint16 maxRoundsPerBatch, address guardian, address reporter, uint32 initialWorkPerThousandBlocks, uint64 targetBlocksPerActiveRound, uint64 difficultySmoothingRounds, uint96 blockUnitsPerBlock))",
]);

export const coreStateAbi = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
]);

export const miningStateAbi = parseAbi([
  "function state() view returns ((uint256 minted, uint256 paid, uint256 totalWeight, uint256 rewardIndex, uint64 closedThroughBlock, uint64 lastActivationRound, uint256 weightActivationCursor, uint256 weightActivationCount, bool bootstrapped, uint64 processedThroughRound, uint64 closedCumulativeWork, uint96 closedCumulativeBlockUnits, uint32 closedWorkPerThousandBlocks))",
]);

export const batchSettledEvent = parseAbiItem(
  "event BatchSettled(bytes32 indexed digest, address indexed reporter, uint64 indexed settledThroughRound, uint256 nonce, uint64 previousSettledThroughRound, uint16 activeRoundCount, uint64 cumulativeWork, uint96 cumulativeBlockUnits)",
);
export const pausedEvent = parseAbiItem("event Paused(address account)");
export const unpausedEvent = parseAbiItem("event Unpaused(address account)");
export const reporterUpdatedEvent = parseAbiItem(
  "event ReporterUpdated(address indexed previousReporter, address indexed newReporter)",
);
export const checkpointedEvent = parseAbiItem(
  "event Checkpointed(uint64 indexed afterRound, uint64 indexed throughRound, uint64 completedBlocks, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint256 amount, uint256 minted, uint64 lastActivationRound, uint256 totalWeight, uint256 rewardIndex)",
);

export const trackedEvents = [batchSettledEvent, pausedEvent, unpausedEvent, reporterUpdatedEvent, checkpointedEvent] as const;
