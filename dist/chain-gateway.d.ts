export type AtomicAmount = string;
export type NetworkId = 'synergy:testnet-v3';
export type TransactionStatus = 'pending' | 'finalized' | 'failed';

export interface NetworkDescriptor {
  readonly chainId: 1266;
  readonly walletChainId: 'synergy:1266';
  readonly network: NetworkId;
  readonly runtimeSlug: 'synergy-testnet-v3';
  readonly name: string;
  readonly rpcUrl: string;
  readonly pairingUrl: string;
}

export interface MetadataReference {
  readonly uri: string;
  readonly sha256: string;
}

export interface TokenReference {
  readonly collectionId: string;
  readonly tokenId: string;
}

interface Request {
  readonly account: string;
  readonly network: NetworkId;
  readonly idempotencyKey: string;
}

interface Royalty {
  readonly royaltyBps: number;
  readonly royaltyRecipient: string;
}

interface CollectionFields extends Royalty {
  readonly collectionId: string;
  readonly name: string;
  readonly symbol: string;
  readonly metadata: MetadataReference;
}

export type ChainIntent = Request & (
  | ({ readonly kind: 'createCollection' } & CollectionFields)
  | ({ readonly kind: 'mint'; readonly owner: string; readonly metadata: MetadataReference } & TokenReference)
  | ({ readonly kind: 'approve'; readonly operator: string; readonly approved: boolean } & TokenReference)
  | ({ readonly kind: 'list'; readonly listingId: string; readonly price: AtomicAmount } & TokenReference)
  | ({ readonly kind: 'offer'; readonly offerId: string; readonly seller: string; readonly price: AtomicAmount } & TokenReference)
  | { readonly kind: 'cancelListing'; readonly listingId: string }
  | { readonly kind: 'cancelOffer'; readonly offerId: string }
  | { readonly kind: 'settle'; readonly orderType: 'listing' | 'offer'; readonly orderId: string; readonly expectedPrice: AtomicAmount }
  | ({ readonly kind: 'setRoyalty'; readonly collectionId: string } & Royalty)
  | ({ readonly kind: 'transfer'; readonly recipient: string } & TokenReference)
);

export type Collection = CollectionFields & { readonly creator: string };
export type Token = TokenReference & { readonly owner: string; readonly metadata: MetadataReference; readonly approvals: readonly string[] };
export type ActiveListing = TokenReference & { readonly listingId: string; readonly seller: string; readonly price: AtomicAmount; readonly operator: string };
export type ActiveOffer = TokenReference & {
  readonly offerId: string;
  readonly buyer: string;
  readonly seller: string;
  readonly price: AtomicAmount;
  readonly operator: string;
};
export type SettlementTerms = TokenReference & {
  readonly seller: string;
  readonly buyer: string;
  readonly price: AtomicAmount;
  readonly fee: AtomicAmount;
  readonly royalty: AtomicAmount;
  readonly proceeds: AtomicAmount;
  readonly feeRecipient: string;
  readonly royaltyRecipient: string;
};

export interface ChainEventData {
  collectionCreated: Collection;
  tokenMinted: Omit<Token, 'approvals'>;
  tokenTransferred: TokenReference & { from: string; to: string };
  approvalUpdated: TokenReference & { owner: string; operator: string; approved: boolean };
  listingCreated: ActiveListing;
  offerCreated: ActiveOffer;
  listingCanceled: Pick<ActiveListing, 'collectionId' | 'tokenId' | 'listingId' | 'seller'>;
  offerCanceled: Pick<ActiveOffer, 'collectionId' | 'tokenId' | 'offerId' | 'buyer' | 'seller'> & {
    refund: AtomicAmount;
    reason: 'withdrawn' | 'declined' | 'transferred' | 'sold';
  };
  royaltyUpdated: { collectionId: string } & Royalty;
  saleSettled: SettlementTerms & { operator: string } & (
    { listingId: string; offerId?: never } | { offerId: string; listingId?: never }
  );
}

export type ChainEvent = {
  [Kind in keyof ChainEventData]: {
    readonly type: Kind;
    readonly data: Readonly<ChainEventData[Kind]>;
    readonly transactionId: string;
    readonly eventIndex: number;
    readonly blockHeight: number;
    readonly finalized: true;
  };
}[keyof ChainEventData];

export interface ChainBlock {
  readonly height: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly events: readonly ChainEvent[];
}

export interface ChainSnapshot {
  readonly checkpoint: Readonly<{ height: number; hash: string }>;
  readonly tokens: readonly (TokenReference & { readonly owner: string; readonly approvedOperators: readonly string[] })[];
  readonly listings: readonly ActiveListing[];
  readonly offers: readonly (ActiveOffer & { readonly escrow: AtomicAmount })[];
}

export interface PreparedTransaction<Mode extends 'mock' | 'live' = 'mock' | 'live'> {
  readonly id: string;
  readonly mode: Mode;
  readonly intent: ChainIntent;
  readonly expiresAt: number;
  readonly review: {
    readonly operation: string;
    readonly target: string;
    readonly account: string;
    readonly network: string;
    readonly amount?: AtomicAmount;
    readonly currency?: 'SNRG';
    readonly decimals?: 9;
    readonly settlement?: SettlementTerms;
  };
}

export interface TransactionApproval {
  readonly transactionId: string;
  readonly account: string;
  readonly decision: 'approve' | 'reject';
}

export type ChainReceipt<Mode extends 'mock' | 'live' = 'mock' | 'live'> = {
  readonly id: string;
  readonly mode: Mode;
  readonly intentKind: ChainIntent['kind'];
  readonly account: string;
  readonly submittedAt: number;
} & (
  | { readonly status: 'pending' }
  | { readonly status: 'finalized'; readonly block: ChainBlock; readonly finishedAt: number }
  | { readonly status: 'failed'; readonly code: string; readonly message: string; readonly finishedAt: number }
);

export type LiveGate =
  | 'approved_deployment' | 'verified_wallet_signing' | 'verified_finalized_receipts'
  | 'verified_indexer' | 'deterministic_contract_tests' | 'end_to_end_wallet_tests' | 'security_review';

type Capabilities<Mode> = Mode extends 'mock'
  ? { mode: 'mock'; canPractice: true; canSettleLive: false; operator: string }
  : { mode: 'live'; canPractice: false; canSettleLive: false; requiredGates: LiveGate[] };

type Result<Mode, Value> = Mode extends 'live' ? Promise<Value> : Value;

export interface ChainGateway<Mode extends 'mock' | 'live'> {
  readonly mode: Mode;
  readonly network: NetworkDescriptor;
  capabilities(): Capabilities<Mode>;
  prepare(intent: ChainIntent): Result<Mode, PreparedTransaction<Mode>>;
  submit(prepared: PreparedTransaction<Mode>, approval: TransactionApproval): Result<Mode, ChainReceipt<Mode>>;
  getReceipt(id: string): Result<Mode, ChainReceipt<Mode> | null>;
  getBlock(height: number): Result<Mode, ChainBlock | null>;
  getCollection(id: string): Result<Mode, Collection | null>;
  getToken(collectionId: string, tokenId: string): Result<Mode, Token | null>;
  getBalance(account: string): Result<Mode, AtomicAmount>;
  getSnapshot(): Result<Mode, ChainSnapshot>;
}

export type MockScenario = 'success' | 'delayed' | 'reverted';
export interface MockGatewayOptions {
  now?: () => number;
  scenario?: MockScenario | ((intent: ChainIntent) => MockScenario);
  delayMs?: number;
  balances?: Readonly<Record<string, AtomicAmount>>;
  operator?: string;
  feeRecipient?: string;
  feeBps?: number;
}

export interface VerifiedDeployment {
  readonly network: NetworkId;
  readonly chainId: 1266;
  readonly genesisHash: string;
  readonly chainIncarnation: number;
  readonly contractBindings: Readonly<Record<'collections' | 'marketplace', {
    readonly address: string;
    readonly abiSha256: string;
    readonly bytecodeSha256: string;
  }>>;
  readonly evidence: Readonly<Record<LiveGate, string>>;
}

export interface VerifiedLiveTransport {
  verifyNetwork(deployment: VerifiedDeployment, signal?: AbortSignal): Promise<void>;
  prepare(intent: ChainIntent, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<PreparedTransaction<'live'>>;
  sign(prepared: PreparedTransaction<'live'>, approval: TransactionApproval, signal?: AbortSignal): Promise<Uint8Array>;
  submitSigned(signed: Uint8Array, signal?: AbortSignal): Promise<string>;
  getVerifiedReceipt(id: string, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<ChainReceipt<'live'> | null>;
  getVerifiedBlock(height: number, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<ChainBlock | null>;
  getVerifiedSnapshot(deployment: VerifiedDeployment, signal?: AbortSignal): Promise<ChainSnapshot>;
  getVerifiedCollection(id: string, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<Collection | null>;
  getVerifiedToken(reference: TokenReference, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<Token | null>;
  getVerifiedBalance(account: string, deployment: VerifiedDeployment, signal?: AbortSignal): Promise<AtomicAmount>;
}

export class GatewayError extends Error {
  constructor(code: string, message: string);
  readonly code: string;
}

export const LIVE_TRADING_ENABLED: false;
export function createMockChainGateway(options?: MockGatewayOptions): ChainGateway<'mock'>;
export function createLiveChainGateway(options?: { deployment?: VerifiedDeployment; transport?: VerifiedLiveTransport }): ChainGateway<'live'>;
