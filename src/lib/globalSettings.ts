export type GlobalSettings = {
  language: 'en' | 'zh-CN';
  showDemoProject: boolean;
  codeFontSize: number;
  codeLineHeight: number;
  syntaxHighlighting: boolean;
  showLineNumbers: boolean;
  showReadmePreview: boolean;
  filePreviewLimitKb: number;
  defaultReviewTab: 'topics' | 'changes' | 'commits';
  fileChangeDetection: 'observer' | 'timer';
  expandDiffs: boolean;
  copilotProvider: 'deepseek' | 'openai';
  copilotModel: 'deepseek-flash' | 'deepseek-v4-pro';
  copilotOpenAiModel: string;
  copilotSummaryLanguage: 'en' | 'zh-CN';
  copilotReviewLanguage: 'en' | 'zh-CN';
  copilotReviewConcurrency: number;
  copilotDeepSeekApiKey: string;
  copilotOpenAiApiKey: string;
  autoGenerateTopicsOnCreate: boolean;
  githubPersonalAccessToken: string;
};

const STORAGE_KEY = 'ming-global-settings-v2';
const LEGACY_STORAGE_KEY = 'ming-global-settings-v1';

export const defaultGlobalSettings: GlobalSettings = {
  language: 'en',
  showDemoProject: true,
  codeFontSize: 13, codeLineHeight: 24,
  syntaxHighlighting: true, showLineNumbers: true,
  showReadmePreview: true, filePreviewLimitKb: 500,
  defaultReviewTab: 'topics', fileChangeDetection: 'observer', expandDiffs: true,
  copilotProvider: 'deepseek', copilotModel: 'deepseek-flash', copilotDeepSeekApiKey: '',
  copilotOpenAiModel: 'gpt-4.1', copilotOpenAiApiKey: '', copilotSummaryLanguage: 'en', copilotReviewLanguage: 'en', copilotReviewConcurrency: 4,
  autoGenerateTopicsOnCreate: false,
  githubPersonalAccessToken: '',
};

export function parseGlobalSettings(value: string | null): GlobalSettings {
  if (!value) return { ...defaultGlobalSettings };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaultGlobalSettings };
    const settings = parsed as Partial<GlobalSettings>;
    const choice = <T extends string | number>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
    const flag = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;
    const shortText = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : '';
    return {
      language: choice(settings.language, ['en', 'zh-CN'], defaultGlobalSettings.language),
      showDemoProject: flag(settings.showDemoProject, true),
      codeFontSize: choice(settings.codeFontSize, [12, 13, 14, 15, 16], defaultGlobalSettings.codeFontSize),
      codeLineHeight: choice(settings.codeLineHeight, [20, 24, 28, 32], defaultGlobalSettings.codeLineHeight),
      syntaxHighlighting: flag(settings.syntaxHighlighting, true),
      showLineNumbers: flag(settings.showLineNumbers, true),
      showReadmePreview: flag(settings.showReadmePreview, true),
      filePreviewLimitKb: choice(settings.filePreviewLimitKb, [100, 500, 1000, 2000], defaultGlobalSettings.filePreviewLimitKb),
      defaultReviewTab: choice(settings.defaultReviewTab, ['topics', 'changes', 'commits'], defaultGlobalSettings.defaultReviewTab),
      fileChangeDetection: choice(settings.fileChangeDetection, ['observer', 'timer'], 'observer'),
      expandDiffs: flag(settings.expandDiffs, true),
      copilotProvider: choice(settings.copilotProvider, ['deepseek', 'openai'], defaultGlobalSettings.copilotProvider),
      copilotModel: choice(settings.copilotModel, ['deepseek-flash', 'deepseek-v4-pro'], defaultGlobalSettings.copilotModel),
      copilotOpenAiModel: shortText(settings.copilotOpenAiModel, 100).trim() || defaultGlobalSettings.copilotOpenAiModel,
      copilotSummaryLanguage: choice(settings.copilotSummaryLanguage, ['en', 'zh-CN'], defaultGlobalSettings.copilotSummaryLanguage),
      copilotReviewLanguage: choice(settings.copilotReviewLanguage, ['en', 'zh-CN'], defaultGlobalSettings.copilotReviewLanguage),
      copilotReviewConcurrency: choice(settings.copilotReviewConcurrency, [1, 2, 3, 4, 6, 8], defaultGlobalSettings.copilotReviewConcurrency),
      copilotDeepSeekApiKey: shortText(settings.copilotDeepSeekApiKey, 500),
      copilotOpenAiApiKey: shortText(settings.copilotOpenAiApiKey, 500),
      autoGenerateTopicsOnCreate: flag(settings.autoGenerateTopicsOnCreate, false),
      githubPersonalAccessToken: shortText(settings.githubPersonalAccessToken, 500),
    };
  } catch { return { ...defaultGlobalSettings }; }
}

export function loadGlobalSettings(): GlobalSettings {
  try { return parseGlobalSettings(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)); }
  catch { return { ...defaultGlobalSettings }; }
}

export function saveGlobalSettings(settings: GlobalSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function shouldShowDemoProject(settings: GlobalSettings, projectCount: number, hasCreatedRealProject: boolean): boolean {
  return settings.showDemoProject && projectCount === 0 && !hasCreatedRealProject;
}
