# 隔离浏览器启动故障诊断（2026-10-09）

本报告保留恢复前的三个临时浏览器实例诊断。它们在生成 `DevToolsActivePort` 之前阻塞；没有取得 CDP ownership 收据，扩展加载及产品断言均未开始。结论属于测试环境诊断，不能据此判断 FluentRead 功能成功或失败。随后取得授权并恢复服务的独立收据与重跑结果见[合并前验证](./merge-validation.md)。

精简证据见 [browser-startup-diagnosis.json](./browser-startup-diagnosis.json)。原启动结果分别见 [fixed Home](./fixed-home-recovery/report.json)、[fixed Base padding](./fixed-base-padded-asr/report.json)、[refactored final metadata](./refactored-final-metadata-only/report.json)。这三次实际启动调用均显式使用 `require_escalated`；超时不能归因于遗漏该权限。

## 本次实例与调用栈

只读进程检查核对了 PID、启动时间、可执行路径及完整的任务专用 `--user-data-dir`。诊断时三个实例仍存活、CPU 为 0，且没有 DevTools TCP 监听。

| 本次实例 | 启动时间（UTC+8） | 一秒主线程样本 | 相同等待栈占比 |
| --- | --- | --- | --- |
| Chrome 72743 / fixed Home | 02:16:11.915 | 772 | 100% |
| Chrome 74237 / fixed Base padding | 02:19:11.109 | 766 | 100% |
| Edge 75049 / refactored metadata | 02:24:49.477 | 800 | 100% |

三次采样均在 `Client CFPasteboard-Apple CFPasteboard general` 队列看到相同主线程阻塞链：

```text
NSApplication.initialize
  → _NS_SetBasicPasteTelemetry
  → NSPasteboard._pasteboardWithName
  → CFPasteboardCreate
  → _CFPBXPCSendMessageWithReplySync
  → xpc_connection_send_message_with_reply_sync
  → mach_msg2_trap
```

这定位了 macOS 剪贴板初始化的同步 IPC 等待，发生于扩展和模型启动之前。采样不能确定剪贴板服务内部的阻塞原因，也不能保证重启一定恢复。

原始一秒采样仅保存在本机临时诊断目录，没有加入仓库；JSON 保存文件 SHA-256 与采样时间，摘要保留在本报告中：

- `/private/tmp/fluentread-x-ai-browser-startup-diagnosis-20261009/chrome-72743-sample.txt`
- `/private/tmp/fluentread-x-ai-browser-startup-diagnosis-20261009/chrome-74237-sample.txt`
- `/private/tmp/fluentread-x-ai-browser-startup-diagnosis-20261009/edge-75049-sample.txt`

两个保留的 Home profile 只有 `BrowserMetrics`，没有完成 profile 初始化；Base padding 的临时目录曾被旧测试 finally 提前删除，已在 [failed-attempts.json](./failed-attempts.json) 记录。其进程采样仍显示同一初始化等待，不能把目录删除认定为共同超时原因。

仅查询本次已知失败测试 PID 对应时间段的崩溃诊断引用，没有匹配记录；未读取用户日常 profile、共享 Crashpad 目录或宽泛日志。没有 CDP ownership 收据，未向这些浏览器发送关闭或终止信号。

## 已核对的服务与待批准动作

只读 `launchctl print` 和系统服务 plist 一致确认：当前用户 domain 为 `gui/501`，label 为 `com.apple.pboard`，完整 target 为 `gui/501/com.apple.pboard`。诊断时服务为 `running`、PID `28109`、`runs=2`；程序为 `/usr/libexec/pboard`，Mach 服务包含 `com.apple.pasteboard.1`。`running` 只说明进程存活，不能证明 IPC 请求能正常响应。

需要用户明确批准后，才考虑执行以下单次最小恢复命令：

```sh
/bin/launchctl kickstart -kp gui/501/com.apple.pboard
```

本机 `launchctl` 手册确认 `-k` 会先终止正在运行的该服务再启动，`-p` 输出进程 PID。重启影响当前用户共享剪贴板，当前内容应按可能丢失处理；复制、粘贴和通用剪贴板可能短暂不可用。没有读取剪贴板内容，也没有验证任何格式会自动恢复。

本次未执行恢复、kill、profile 清理或新浏览器启动。批准并恢复后，下一步是只复查该服务状态，再用新临时 profile 串行进行一次隔离启动和产品验收；启动失败仍不得计为产品通过。
