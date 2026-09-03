/**
 * DSH Mobile 通信协议 TypeScript 接口定义
 * 基于 saya-ch/dsh-mobile 与 DeepSeek Harness Desktop 逆向整理。
 * 供微信小程序（JavaScript）实现时参考；纯类型文件，不产生运行时代码。
 */

/* =========================================================================
 * 基础类型
 * ========================================================================= */

/** 会话 ID（字符串 brand） */
export type SessionId = string;
/** 工具调用 ID */
export type ToolCallId = string;
/** 消息 ID */
export type MessageId = string;
/** 事件序列号（会话内单调递增整数） */
export type EventSeq = number;
/** 毫秒整数时间戳 */
export type EventTime = number;

/** 任意 JSON 值 */
export type JsonValue =
  | null | boolean | number | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/* =========================================================================
 * 1. 配对 / 认证
 * ========================================================================= */

/** POST /mobile-access/auth/native-pair 请求体 */
export interface NativePairRequest {
  /** 配对码，来自 DSH 桌面端「移动访问」面板 */
  token: string;
  /** 设备标签（可选） */
  label?: string;
}

/** native-pair 响应 */
export interface NativePairResponse {
  instanceId: string;
  deviceId: string;
  /** 用于续期 */
  deviceToken: string;
  deviceExpiresAt: number;
  /** 用作 Cookie dsh_ma_session */
  sessionToken: string;
  /** 用作 HTTP 头 x-dsh-mobile-csrf */
  csrfToken: string;
  sessionExpiresAt: number;
}

/** POST /mobile-access/auth/native-renew 请求体 */
export interface NativeRenewRequest {
  deviceToken: string;
}

/** native-renew 响应（无 deviceToken） */
export interface NativeRenewResponse {
  instanceId: string;
  deviceId: string;
  sessionToken: string;
  csrfToken: string;
  sessionExpiresAt: number;
}

/* =========================================================================
 * 2. HTTP JSON-RPC 信封
 * ========================================================================= */

/** 客户端请求信封 */
export interface ClientRequest {
  type: 'client-request';
  rpcId: string;
  /** namespace/method，如 session/prompt */
  method: string;
  payload: { args: JsonValue };
}

/** 服务端响应信封 */
export interface ServerResponse {
  type: 'server-response';
  rpcId: string;
  result: RpcResult;
}

/** RPC 结果 */
export type RpcResult =
  | { ok: true; value: JsonValue }
  | { ok: false; error: RpcError };

/** RPC 失败 */
export interface RpcError {
  code: string;
  message: string;
  details: { [key: string]: JsonValue };
}

/* =========================================================================
 * 3. 消息发送模型（RPC 方法参数）
 * ========================================================================= */

/** 会话列表请求 */
export interface SessionListArgs { _request?: {}; }

/** 会话摘要（session/list 的 items 元素） */
export interface SessionSummary {
  sessionId: SessionId;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  cwd?: string;
  /** 是否空白会话（尚无对话） */
  blank?: boolean;
  /** 是否正在生成 */
  running?: boolean;
  /** 最近活动时间 */
  activityAt?: number;
  parentSession?: SessionId;
  seedLength?: number;
  agentPreset?: string;
  /** 额外投影字段（tokenUsage、modelSelection 等） */
  [key: string]: JsonValue;
}

/** 新建会话请求 */
export interface SessionCreateArgs {
  /** 工作区 ID 或 cwd，二选一 */
  workspaceId?: string;
  cwd?: string;
  agentPreset?: string;
}

/** 新建会话响应 */
export interface SessionCreateResult {
  sessionId: SessionId;
  [key: string]: JsonValue;
}

/** 消息内容块 */
export type PromptContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ImageAttachmentRef };

/** 图片附件引用 */
export interface ImageAttachmentRef {
  attachmentId: string;
  mediaType: string;
}

/** 发送消息请求（session/prompt） */
export interface SessionPromptArgs {
  /** 客户端生成的请求 id（用于 echo 与失败重试关联） */
  requestId: string;
  sessionId: SessionId;
  /** queue=排队追加，steer=插队转向 */
  mode: 'queue' | 'steer';
  content: PromptContentBlock[];
  /** IANA 时区名，如 Asia/Shanghai（可选） */
  clientTimeZone?: string;
}

/** 发送消息响应 */
export interface SessionPromptResult { accepted: true; }

/** 重命名请求 */
export interface SessionRenameArgs { sessionId: SessionId; title: string; }
/** 重命名响应 */
export interface SessionRenameResult { title: string; seq: EventSeq; }

/** 派生会话请求 */
export interface SessionForkArgs { sessionId: SessionId; atSeq?: EventSeq; }
/** 派生会话响应 */
export interface SessionForkResult { sessionId: SessionId; }

/** 停止生成请求 */
export interface SessionCancelArgs { sessionId: SessionId; }
/** 停止生成响应 */
export interface SessionCancelResult { accepted: true; }

/** 归档会话请求（删除/归档走 workspace 维度，无 session/delete） */
export interface WorkspaceArchiveSessionArgs {
  workspaceId?: string;
  sessionId: SessionId;
}

/** 删除工作区请求 */
export interface WorkspaceDeleteArgs {
  workspaceId: string;
}

/** 历史分页请求（session/page） */
export interface SessionPageArgs {
  address: SessionAddress;
  /** 已加载到的事件序号（下一页的上边界） */
  throughSeq: EventSeq;
  /** 更早的边界（可选） */
  beforeSeq?: EventSeq;
  /** 每页消息条数（可选，网关会限制到 10） */
  maxMessages?: number;
}

/** 历史分页响应 */
export interface SessionPageResult {
  records: HistoryRecord[];
  hasMore: boolean;
  projections?: { [key: string]: JsonValue };
}

/** 会话地址（follow / page 用） */
export interface SessionAddress {
  kind: 'session';
  sessionId: SessionId;
}

/* =========================================================================
 * 4. WebSocket Remote Stream 帧
 * ========================================================================= */

/** 客户端 → 服务端：打开流 */
export interface RemoteStreamOpen {
  type: 'open';
  streamId: string;
  endpoint: string;
  payload: { args: JsonValue };
}

/** 客户端 → 服务端：取消流 */
export interface RemoteStreamCancel {
  type: 'cancel';
  streamId: string;
}

/** 服务端 → 客户端：数据帧 */
export interface RemoteStreamItem {
  type: 'item';
  streamId: string;
  value: JsonValue;
}

/** 服务端 → 客户端：流结束 */
export interface RemoteStreamEnd { type: 'end'; streamId: string; }

/** 服务端 → 客户端：流出错 */
export interface RemoteStreamError {
  type: 'error';
  streamId: string;
  error: RpcError;
}

export type RemoteStreamServerFrame =
  | RemoteStreamItem
  | RemoteStreamEnd
  | RemoteStreamError;

/* =========================================================================
 * 5. 消息接收模型：Session 事件
 * ========================================================================= */

/** 会话事件信封（统一结构） */
export interface SessionEvent {
  type: string;
  seq: EventSeq;
  time: EventTime;
  data: JsonValue;
  /** 仅 surface 事件携带：append | { op: 'replace', start, end } */
  surfaceOp?: 'append' | ReplaceOp;
}

/** 位置替换操作 */
export interface ReplaceOp {
  op: 'replace';
  start: EventSeq;
  end: EventSeq;
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant';

/** 消息内容块（渲染用） */
export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; toolCallId: string; content: unknown; isError?: boolean }
  | { type: 'image'; attachment: ImageAttachmentRef };

/** LLM 消息 */
export interface LlmMessage {
  id: MessageId;
  role: MessageRole;
  content: MessageContentBlock[];
  source?: { kind: 'user' | 'model' | 'tool'; [key: string]: JsonValue };
}

/** assistant/chunk 的增量类型 */
export type ChunkType =
  | 'text-delta'
  | 'reasoning-delta'
  | 'tool-call-delta'
  | 'block-end';

/** 流式增量 chunk */
export type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: MessageContentBlock };

/** assistant/chunk 事件 data */
export interface AssistantChunkData {
  turn: number;
  step: number;
  chunk: StreamChunk;
}

/** user/message 事件 data */
export interface UserMessageData {
  message: LlmMessage;
}

/** assistant/message 事件 data */
export interface AssistantMessageData {
  turn: number;
  step: number;
  message: LlmMessage;
}

/** tool/result 事件 data */
export interface ToolResultData {
  turn: number;
  step: number;
  message: LlmMessage;
  meta?: JsonValue;
}

/** tool/call 事件 data */
export interface ToolCallData {
  turn: number;
  step: number;
  callId: ToolCallId;
  name: string;
  arguments: string;
}

/** step/start 与 step/end 事件 data */
export interface StepBoundaryData { turn: number; step: number; }

/** turn/start 事件 data */
export interface TurnStartData { turn: number; }

/** turn/end 事件 data */
export interface TurnEndData {
  turn: number;
  reason: { kind: 'completed' | 'max-tokens' | 'cancelled' | string; [key: string]: JsonValue };
}

/** todo 项 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** todo/write 事件 data */
export interface TodoWriteData { todos: TodoItem[]; }

/* =========================================================================
 * 6. history record（follow / page 的 records 元素）
 * ========================================================================= */

/** 普通事件记录 */
export interface EventRecord {
  type: 'event';
  event: SessionEvent;
}

/** 打包的增量 run（连续同类 text-delta 压缩为一行） */
export interface ChunkRowRecord {
  type: 'chunk';
  event: ChunkRow;
}

export type HistoryRecord = EventRecord | ChunkRowRecord;

/** 打包行（dsh-session/chunk-rows） */
export type ChunkRow =
  | { type: 'chunkrow/text-chunks'; seq: EventSeq; time: EventTime;
      data: { turn: number; step: number; index: number; dt: number[]; texts: string[] } }
  | { type: 'chunkrow/reasoning-chunks'; seq: EventSeq; time: EventTime;
      data: { turn: number; step: number; index: number; dt: number[]; texts: string[] } }
  | { type: 'chunkrow/tool-call-chunks'; seq: EventSeq; time: EventTime;
      data: { turn: number; step: number; index: number; dt: number[]; id: string; name?: string; args: string[] } };

/* =========================================================================
 * 7. session/follow 流返回帧
 * ========================================================================= */

/** 打开流后的首个快照帧 */
export interface FollowSnapshot {
  type: 'snapshot';
  cursor: EventSeq;
  records: HistoryRecord[];
  hasMore: boolean;
  projections?: { [key: string]: JsonValue };
}

/** session/follow 逻辑帧（value 字段） */
export type FollowFrame = FollowSnapshot | HistoryRecord;

/* =========================================================================
 * 8. session/control 流（状态变更）
 * ========================================================================= */

/** control 基线帧 */
export interface ControlBaseline {
  type: 'baseline';
  value: {
    queues: { [sessionId: string]: JsonValue[] };
    jobs: { [sessionId: string]: JobView[] };
    projections: { [sessionId: string]: JsonValue };
  };
}

/** 任务视图 */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: string;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

/** control 更新帧（projection / queue / jobs） */
export interface ControlProjectionFrame {
  type: 'projection';
  sessionId: SessionId;
  key: string;
  value: JsonValue;
  seq: EventSeq;
}
export interface ControlQueueFrame {
  type: 'queue';
  sessionId: SessionId;
  items: JsonValue[];
}
export interface ControlJobsFrame {
  type: 'jobs';
  sessionId: SessionId;
  jobs: JobView[];
}

export type ControlFrame =
  | ControlBaseline
  | ControlProjectionFrame
  | ControlQueueFrame
  | ControlJobsFrame;

/* =========================================================================
 * 9. Remote Event（ask 问询 / approval 审批，走 $events 流）
 * ========================================================================= */

/** 事件流就绪帧（首个） */
export interface RemoteEventReady {
  type: 'ready';
  clientId: string;
  host: { home: string };
}

/** 瀑布式请求帧（问询/审批） */
export interface RemoteEventWaterfall {
  type: 'waterfall';
  event: string;
  eventId: string;
  agentId: string;
  request: JsonValue;
}

/** 单向事件帧 */
export interface RemoteEventEmit {
  type: 'emit';
  event: string;
  args: JsonValue[];
}

/** 取消帧 */
export interface RemoteEventCancel { type: 'cancel'; eventId: string; }

export type RemoteEventFrame =
  | RemoteEventReady
  | RemoteEventWaterfall
  | RemoteEventEmit
  | RemoteEventCancel;

/* --- approval 审批 --- */

/** approval/request 的 request */
export interface ApprovalRequest {
  toolName: string;
  callId?: string;
  reason?: string;
}

/** 审批回答值 */
export type ApprovalOutcomeValue = 'allowed-once' | 'rejected';

/* --- ask 问询（user-questions/request） --- */

/** 单个问题选项 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** 单个问题 */
export interface Question {
  id: string;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: QuestionOption[];
  intent?: { kind: string; approve?: string; [key: string]: JsonValue };
  detail?: string;
}

/** user-questions/request 的 request */
export interface UserQuestionsRequest {
  questions: Question[];
}

/** 问询回答格式 */
export interface QuestionAnswerBatch {
  answers: Array<{
    id: string;
    selected: string[];
    custom?: string;
  }>;
}

/* --- 回答投递（$events/result） --- */

/** 回答投递 args */
export interface RemoteEventResultArgs {
  clientId: string;
  eventId: string;
  outcome: RemoteEventOutcome;
}

/** 回答结果 */
export type RemoteEventOutcome =
  | { kind: 'result'; value: JsonValue }
  | { kind: 'rejected'; error: { name: string; message: string; code?: string; details?: JsonValue } }
  | { kind: 'next' };
