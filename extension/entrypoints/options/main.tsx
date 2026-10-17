// 挂载扩展设置界面，加载全局基础样式。
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';
import { initializeTheme } from '../../src/ui/ThemePicker';
import '../../src/ui/library.css';
import '../../src/ui/base.css';

initializeTheme();
createRoot(document.getElementById('root')!).render(<App />);
