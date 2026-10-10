/**
 * @file src/app/content/areaContextMenuResponse.ts
 * 文件职责：把按需圈选入口的同步或异步结果转换成内容消息回复。
 * 主要内容：先拒绝不支持的浏览器，再等待 UI 挂载和选区启动，区分成功、停用与异常。
 * 模块边界：只处理消息结果，不注册右键菜单、不创建 DOM；入口和覆盖层由 area-translation feature 管理。
 */
export function respondToAreaContextMenu(
    enabled: boolean,
    start: () => boolean | Promise<boolean>,
    respond: (response: {status: 'success' | 'disabled' | 'failed'}) => void,
): void {
    if (!enabled) {
        respond({status: 'disabled'});
        return;
    }
    void Promise.resolve().then(start)
        .then(started => respond({status: started ? 'success' : 'disabled'}))
        .catch(() => respond({status: 'failed'}));
}
