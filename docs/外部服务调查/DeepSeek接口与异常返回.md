<!-- 保存DeepSeek接口与思考参数的历史核对，并说明扩展对异常返回的处理。 -->
# DeepSeek接口与异常返回

[文档目录](../README.md)

本文保留2026-10-13至14日的接口文档核对，模型与参数名称均为记录当时的内容，不代表当前服务商配置。扩展的服务和模型设置见[AI服务与计划分析](../使用指南/AI服务与计划分析.md)。本次清理没有重新核验服务商接口。

## DeepSeek 官方接口文档核对

2026-10-13，使用 Context7【技术文档查询工具】读取官方文档。此节是文档核对，不是付费接口实测：

- 地址：`POST https://api.deepseek.com/chat/completions`【生成分析建议的官方接口】。
- `Authorization: Bearer …`【请求头中的调用密钥】；只发送给上述官方域名，不写入日志。
- 当时核对的模型为 `deepseek-flash`、`deepseek-v4-pro`【两种模型标识】。
- `response_format: {type: "json_object"}`【要求结构化对象输出】，提示词也明确写明 json【结构化文本格式】及预期结构。
- `messages`【对话输入】包含规则顾问指令以及计划、两类视频标题与标签、现有配置。样本本身当作不可信数据，不执行其中指令。
- 只有 `finish_reason: "stop"`【模型正常结束】且能解析并通过结构检查才保存建议；截断、空结果、非法分组均不应用。
- 返回建议字段：`summary`【分析说明】，`suggestions`【建议数组】；每条包含 `side`【偏好或避开分区】、`field`【标题词或标签组】、`word`【单个词条】、`reason`【依据与误伤说明】。
- 常见失败状态：401【密钥无效】、402【余额不足】、429【请求限流】。请求超时或取消不代表服务端没有计费。

官方参考：[接口文档](https://api-docs.deepseek.com/api/create-chat-completion)、[结构化输出](https://api-docs.deepseek.com/guides/json_mode)、[模型列表接口](https://api-docs.deepseek.com/api/list-models)。模型命名与参数将来可能变化，出现兼容问题时优先复查这些来源。

## 扩展的异常返回判断

扩展区分缺少结果、生成达到上限、非正常结束、只有思考过程、空正式结果与无效结构；失败时不保存新建议。正式输出需要完整接收并通过结构检查，思考过程不能作为建议正文。

实现依据：[模型输出校验](../../extension/src/core.ts)与[流式响应处理](../../extension/src/analysis-stream.ts)。当前生成参数和等待规则见[AI服务与计划分析](../使用指南/AI服务与计划分析.md)，请求排查见[调试日志](../使用指南/调试日志.md)。

官方依据：[生成接口及思考模式默认值](https://api-docs.deepseek.com/api/create-chat-completion/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

## 可配置模型参数核对（2026-10-14）

通过 Context7【技术文档查询工具】重新读取官方生成接口，并直接读取思考模式指南：

| 设置 | 官方请求字段及约束 |
| --- | --- |
| 模型 | `model`【模型标识】：`deepseek-flash`、`deepseek-v4-pro`【当前官方两种模型】 |
| 思考模式 | `thinking.type`【模式开关】：`enabled` / `disabled`【开启 / 关闭】 |
| 思考强度 | `reasoning_effort`【推理强度】：`low`、`high`、`max`【低、高、最高】；本版关闭思考时不发送此字段 |
| 生成上限 | `max_tokens`【最大生成量】：官方允许 1–393,216，本版界面使用 1,024–393,216，默认 65,536 |
| 正式回答 | `choices[0].message.content`【最终输出内容】，通过结构检查后才生成建议 |
| 思考过程 | `reasoning_content`【模型思考内容】，不解析为建议、不保存到配置 |

官方默认思考开启、强度为高；本版显式设置用户选择，避免隐含默认行为。直接发送请求体，因此思考参数放在请求体顶层；官方部分 SDK【接口客户端库】示例的附加参数包装不适用于本版的直接请求。

官方示例中非思考默认生成量为 8K【约八千个生成单位】，思考默认 64K、最高强度默认 128K【对应默认额度】，但本版始终使用用户保存的上限，不偷偷因模式变化增加消耗上限。客户端等待为 300 秒，不代表保证在该时间内完成高额度生成。

来源：[生成接口](https://api-docs.deepseek.com/api/create-chat-completion/)、[思考模式与强度控制](https://api-docs.deepseek.com/guides/thinking_mode/)。此节是参数文档核对和离线模拟验证，新增模型/强度组合未在本轮进行付费实测。
