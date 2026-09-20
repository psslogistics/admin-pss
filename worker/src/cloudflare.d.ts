interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta?: Record<string, unknown> }
interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<D1Result>; }
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface R2Object { body: ReadableStream; httpMetadata?: { contentType?: string }; }
interface R2Bucket { get(key: string): Promise<R2Object | null>; put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void>; delete(key: string): Promise<void>; }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
