export type ClientErrorReason = "Transport" | "UnexpectedStatus" | "UnsupportedContentType" | "MalformedResponse" | "SseEventTooLarge";
export declare class ClientError extends Error {
    readonly reason: ClientErrorReason;
    readonly name = "ClientError";
    constructor(reason: ClientErrorReason, options?: ErrorOptions);
}
