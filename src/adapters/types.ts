import type { BrowserInfo, SupportedFramework } from '../core/types';

export interface FrameworkAdapter {
  framework: SupportedFramework;
  actionMethods: string[];
  extractBrowserInfo(page: any): BrowserInfo;
}
