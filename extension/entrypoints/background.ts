// 注册WXT后台生命周期，业务装配和消息处理由平台运行模块负责。
import { defineBackground } from 'wxt/utils/define-background';
import { startBackground } from '../src/platform/background';
export { PREFERENCES_KEY } from '../src/platform/background';
export default defineBackground(startBackground);
