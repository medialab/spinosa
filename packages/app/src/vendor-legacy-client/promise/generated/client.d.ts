import type { HealthStopInput, ServerGetOutput, LocationGetInput, LocationGetOutput, AgentListInput, AgentListOutput, PluginListInput, PluginListOutput, SessionListInput, SessionCreateInput, SessionGetInput, SessionRemoveInput, SessionForkInput, SessionSwitchAgentInput, SessionSwitchModelInput, SessionRenameInput, SessionMoveInput, SessionPromptInput, SessionCommandInput, SessionSkillInput, SessionSyntheticInput, SessionShellInput, SessionCompactInput, SessionWaitInput, SessionRevertStageInput, SessionRevertClearInput, SessionRevertCommitInput, SessionContextInput, SessionPendingListInput, SessionInstructionsEntryListInput, SessionInstructionsEntryPutInput, SessionInstructionsEntryRemoveInput, SessionGenerateInput, SessionLogInput, SessionLogOutput, SessionInterruptInput, SessionBackgroundInput, SessionMessageInput, MessageListInput, ModelListInput, ModelListOutput, ModelDefaultInput, ModelDefaultOutput, GenerateTextInput, ProviderListInput, ProviderListOutput, ProviderGetInput, ProviderGetOutput, IntegrationListInput, IntegrationListOutput, IntegrationGetInput, IntegrationGetOutput, IntegrationWellknownAddInput, IntegrationConnectKeyInput, IntegrationOauthConnectInput, IntegrationOauthConnectOutput, IntegrationOauthStatusInput, IntegrationOauthStatusOutput, IntegrationOauthCompleteInput, IntegrationOauthCancelInput, IntegrationCommandConnectInput, IntegrationCommandConnectOutput, IntegrationCommandStatusInput, IntegrationCommandStatusOutput, IntegrationCommandCancelInput, McpListInput, McpListOutput, McpAddInput, McpRemoveInput, McpConnectInput, McpDisconnectInput, McpResourceCatalogInput, McpResourceCatalogOutput, CredentialUpdateInput, CredentialRemoveInput, ProjectListOutput, ProjectCurrentInput, ProjectDirectoriesInput, FormRequestListInput, FormRequestListOutput, FormListInput, FormCreateInput, FormGetInput, FormStateInput, FormReplyInput, FormCancelInput, PermissionRequestListInput, PermissionRequestListOutput, PermissionSavedListInput, PermissionSavedRemoveInput, PermissionCreateInput, PermissionListInput, PermissionGetInput, PermissionReplyInput, FileReadInput, FileReadOutput, FileListInput, FileListOutput, FileFindInput, FileFindOutput, CommandListInput, CommandListOutput, SkillListInput, SkillListOutput, EventSubscribeOutput, PtyListInput, PtyListOutput, PtyCreateInput, PtyCreateOutput, PtyGetInput, PtyGetOutput, PtyUpdateInput, PtyUpdateOutput, PtyRemoveInput, ShellListInput, ShellListOutput, ShellCreateInput, ShellCreateOutput, ShellGetInput, ShellGetOutput, ShellTimeoutInput, ShellTimeoutOutput, ShellOutputInput, ShellOutputOutput, ShellRemoveInput, QuestionRequestListInput, QuestionRequestListOutput, QuestionListInput, QuestionReplyInput, QuestionRejectInput, ReferenceListInput, ReferenceListOutput, ProjectCopyCreateInput, ProjectCopyRemoveInput, ProjectCopyRefreshInput, VcsStatusInput, VcsStatusOutput, VcsDiffInput, VcsDiffOutput, DebugLocationListOutput, DebugLocationEvictInput } from "./types";
export interface ClientOptions {
    readonly baseUrl: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly headers?: RequestInit["headers"];
}
export interface RequestOptions {
    readonly signal?: AbortSignal;
    readonly headers?: RequestInit["headers"];
}
export declare function make(options: ClientOptions): {
    health: {
        get: (requestOptions?: RequestOptions) => Promise<import("./types").ServiceHealth>;
        stop: (input: HealthStopInput, requestOptions?: RequestOptions) => Promise<import("./types").ServiceStopResponse>;
    };
    server: {
        get: (requestOptions?: RequestOptions) => Promise<ServerGetOutput>;
    };
    location: {
        get: (input?: LocationGetInput, requestOptions?: RequestOptions) => Promise<LocationGetOutput>;
    };
    agent: {
        list: (input?: AgentListInput, requestOptions?: RequestOptions) => Promise<AgentListOutput>;
    };
    plugin: {
        list: (input?: PluginListInput, requestOptions?: RequestOptions) => Promise<PluginListOutput>;
    };
    session: {
        list: (input?: SessionListInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionsResponse>;
        create: (input?: SessionCreateInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionInfo>;
        active: (requestOptions?: RequestOptions) => Promise<{
            [x: string]: import("./types").SessionActive;
        }>;
        get: (input: SessionGetInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionInfo>;
        remove: (input: SessionRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
        fork: (input: SessionForkInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionInfo>;
        switchAgent: (input: SessionSwitchAgentInput, requestOptions?: RequestOptions) => Promise<void>;
        switchModel: (input: SessionSwitchModelInput, requestOptions?: RequestOptions) => Promise<void>;
        rename: (input: SessionRenameInput, requestOptions?: RequestOptions) => Promise<void>;
        move: (input: SessionMoveInput, requestOptions?: RequestOptions) => Promise<void>;
        prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionPendingUser>;
        command: (input: SessionCommandInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionPendingUser>;
        skill: (input: SessionSkillInput, requestOptions?: RequestOptions) => Promise<void>;
        synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionPendingSynthetic>;
        shell: (input: SessionShellInput, requestOptions?: RequestOptions) => Promise<void>;
        compact: (input: SessionCompactInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionPendingCompaction>;
        wait: (input: SessionWaitInput, requestOptions?: RequestOptions) => Promise<void>;
        revert: {
            stage: (input: SessionRevertStageInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionRevert>;
            clear: (input: SessionRevertClearInput, requestOptions?: RequestOptions) => Promise<void>;
            commit: (input: SessionRevertCommitInput, requestOptions?: RequestOptions) => Promise<void>;
        };
        context: (input: SessionContextInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionMessageInfo[]>;
        pending: {
            list: (input: SessionPendingListInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionPendingInfo[]>;
        };
        instructions: {
            entry: {
                list: (input: SessionInstructionsEntryListInput, requestOptions?: RequestOptions) => Promise<import("./types").InstructionEntryInfo[]>;
                put: (input: SessionInstructionsEntryPutInput, requestOptions?: RequestOptions) => Promise<void>;
                remove: (input: SessionInstructionsEntryRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
            };
        };
        generate: (input: SessionGenerateInput, requestOptions?: RequestOptions) => Promise<{
            text: string;
        }>;
        log: (input: SessionLogInput, requestOptions?: RequestOptions) => AsyncIterable<SessionLogOutput>;
        interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) => Promise<void>;
        background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) => Promise<void>;
        message: (input: SessionMessageInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionMessageAgentSelected | import("./types").SessionMessageSynthetic | import("./types").SessionMessageSystem | import("./types").SessionMessageSkill | import("./types").SessionMessageShell | import("./types").SessionMessageCompactionRunning | import("./types").SessionMessageCompactionCompleted | import("./types").SessionMessageModelSelected | import("./types").SessionMessageCompactionFailed | import("./types").SessionMessageUser | import("./types").SessionMessageAssistant>;
    };
    message: {
        list: (input: MessageListInput, requestOptions?: RequestOptions) => Promise<import("./types").SessionMessagesResponse>;
    };
    model: {
        list: (input?: ModelListInput, requestOptions?: RequestOptions) => Promise<ModelListOutput>;
        default: (input?: ModelDefaultInput, requestOptions?: RequestOptions) => Promise<ModelDefaultOutput>;
    };
    generate: {
        text: (input: GenerateTextInput, requestOptions?: RequestOptions) => Promise<{
            text: string;
        }>;
    };
    provider: {
        list: (input?: ProviderListInput, requestOptions?: RequestOptions) => Promise<ProviderListOutput>;
        get: (input: ProviderGetInput, requestOptions?: RequestOptions) => Promise<ProviderGetOutput>;
    };
    integration: {
        list: (input?: IntegrationListInput, requestOptions?: RequestOptions) => Promise<IntegrationListOutput>;
        get: (input: IntegrationGetInput, requestOptions?: RequestOptions) => Promise<IntegrationGetOutput>;
        wellknown: {
            add: (input: IntegrationWellknownAddInput, requestOptions?: RequestOptions) => Promise<void>;
        };
        connect: {
            key: (input: IntegrationConnectKeyInput, requestOptions?: RequestOptions) => Promise<void>;
        };
        oauth: {
            connect: (input: IntegrationOauthConnectInput, requestOptions?: RequestOptions) => Promise<IntegrationOauthConnectOutput>;
            status: (input: IntegrationOauthStatusInput, requestOptions?: RequestOptions) => Promise<IntegrationOauthStatusOutput>;
            complete: (input: IntegrationOauthCompleteInput, requestOptions?: RequestOptions) => Promise<void>;
            cancel: (input: IntegrationOauthCancelInput, requestOptions?: RequestOptions) => Promise<void>;
        };
        command: {
            connect: (input: IntegrationCommandConnectInput, requestOptions?: RequestOptions) => Promise<IntegrationCommandConnectOutput>;
            status: (input: IntegrationCommandStatusInput, requestOptions?: RequestOptions) => Promise<IntegrationCommandStatusOutput>;
            cancel: (input: IntegrationCommandCancelInput, requestOptions?: RequestOptions) => Promise<void>;
        };
    };
    mcp: {
        list: (input?: McpListInput, requestOptions?: RequestOptions) => Promise<McpListOutput>;
        add: (input: McpAddInput, requestOptions?: RequestOptions) => Promise<void>;
        remove: (input: McpRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
        connect: (input: McpConnectInput, requestOptions?: RequestOptions) => Promise<void>;
        disconnect: (input: McpDisconnectInput, requestOptions?: RequestOptions) => Promise<void>;
        resource: {
            catalog: (input?: McpResourceCatalogInput, requestOptions?: RequestOptions) => Promise<McpResourceCatalogOutput>;
        };
    };
    credential: {
        update: (input: CredentialUpdateInput, requestOptions?: RequestOptions) => Promise<void>;
        remove: (input: CredentialRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    project: {
        list: (requestOptions?: RequestOptions) => Promise<ProjectListOutput>;
        current: (input?: ProjectCurrentInput, requestOptions?: RequestOptions) => Promise<import("./types").ProjectCurrent>;
        directories: (input: ProjectDirectoriesInput, requestOptions?: RequestOptions) => Promise<import("./types").ProjectDirectories>;
    };
    form: {
        request: {
            list: (input?: FormRequestListInput, requestOptions?: RequestOptions) => Promise<FormRequestListOutput>;
        };
        list: (input: FormListInput, requestOptions?: RequestOptions) => Promise<import("./types").FormInfo[]>;
        create: (input: FormCreateInput, requestOptions?: RequestOptions) => Promise<import("./types").FormInfo>;
        get: (input: FormGetInput, requestOptions?: RequestOptions) => Promise<import("./types").FormInfo>;
        state: (input: FormStateInput, requestOptions?: RequestOptions) => Promise<{
            status: "pending";
        } | {
            status: "answered";
            answer: import("./types").FormAnswer;
        } | {
            status: "cancelled";
        }>;
        reply: (input: FormReplyInput, requestOptions?: RequestOptions) => Promise<void>;
        cancel: (input: FormCancelInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    permission: {
        request: {
            list: (input?: PermissionRequestListInput, requestOptions?: RequestOptions) => Promise<PermissionRequestListOutput>;
        };
        saved: {
            list: (input?: PermissionSavedListInput, requestOptions?: RequestOptions) => Promise<import("./types").PermissionSavedInfo[]>;
            remove: (input: PermissionSavedRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
        };
        create: (input: PermissionCreateInput, requestOptions?: RequestOptions) => Promise<{
            id: string;
            effect: import("./types").PermissionV2Effect;
        }>;
        list: (input: PermissionListInput, requestOptions?: RequestOptions) => Promise<import("./types").PermissionV2Request[]>;
        get: (input: PermissionGetInput, requestOptions?: RequestOptions) => Promise<import("./types").PermissionV2Request>;
        reply: (input: PermissionReplyInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    file: {
        read: (input: FileReadInput, requestOptions?: RequestOptions) => Promise<FileReadOutput>;
        list: (input?: FileListInput, requestOptions?: RequestOptions) => Promise<FileListOutput>;
        find: (input: FileFindInput, requestOptions?: RequestOptions) => Promise<FileFindOutput>;
    };
    command: {
        list: (input?: CommandListInput, requestOptions?: RequestOptions) => Promise<CommandListOutput>;
    };
    skill: {
        list: (input?: SkillListInput, requestOptions?: RequestOptions) => Promise<SkillListOutput>;
    };
    event: {
        subscribe: (requestOptions?: RequestOptions) => AsyncIterable<EventSubscribeOutput>;
    };
    pty: {
        list: (input?: PtyListInput, requestOptions?: RequestOptions) => Promise<PtyListOutput>;
        create: (input?: PtyCreateInput, requestOptions?: RequestOptions) => Promise<PtyCreateOutput>;
        get: (input: PtyGetInput, requestOptions?: RequestOptions) => Promise<PtyGetOutput>;
        update: (input: PtyUpdateInput, requestOptions?: RequestOptions) => Promise<PtyUpdateOutput>;
        remove: (input: PtyRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    shell: {
        list: (input?: ShellListInput, requestOptions?: RequestOptions) => Promise<ShellListOutput>;
        create: (input: ShellCreateInput, requestOptions?: RequestOptions) => Promise<ShellCreateOutput>;
        get: (input: ShellGetInput, requestOptions?: RequestOptions) => Promise<ShellGetOutput>;
        timeout: (input: ShellTimeoutInput, requestOptions?: RequestOptions) => Promise<ShellTimeoutOutput>;
        output: (input: ShellOutputInput, requestOptions?: RequestOptions) => Promise<ShellOutputOutput>;
        remove: (input: ShellRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    question: {
        request: {
            list: (input?: QuestionRequestListInput, requestOptions?: RequestOptions) => Promise<QuestionRequestListOutput>;
        };
        list: (input: QuestionListInput, requestOptions?: RequestOptions) => Promise<import("./types").QuestionV2Request[]>;
        reply: (input: QuestionReplyInput, requestOptions?: RequestOptions) => Promise<void>;
        reject: (input: QuestionRejectInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    reference: {
        list: (input?: ReferenceListInput, requestOptions?: RequestOptions) => Promise<ReferenceListOutput>;
    };
    projectCopy: {
        create: (input: ProjectCopyCreateInput, requestOptions?: RequestOptions) => Promise<import("./types").ProjectCopyCopy>;
        remove: (input: ProjectCopyRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
        refresh: (input: ProjectCopyRefreshInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    vcs: {
        status: (input?: VcsStatusInput, requestOptions?: RequestOptions) => Promise<VcsStatusOutput>;
        diff: (input: VcsDiffInput, requestOptions?: RequestOptions) => Promise<VcsDiffOutput>;
    };
    debug: {
        location: {
            list: (requestOptions?: RequestOptions) => Promise<DebugLocationListOutput>;
            evict: (input?: DebugLocationEvictInput, requestOptions?: RequestOptions) => Promise<void>;
        };
    };
};
