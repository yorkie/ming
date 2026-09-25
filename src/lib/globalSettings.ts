export type GlobalSettings = {
  codeFontSize: number;
  codeLineHeight: number;
  syntaxHighlighting: boolean;
  showLineNumbers: boolean;
  showReadmePreview: boolean;
  filePreviewLimitKb: number;
  defaultReviewTab: 'changes' | 'commits';
  expandDiffs: boolean;
  richMarkdownByDefault: boolean;
  copilotProvider: 'openai' | 'anthropic' | 'google' | 'custom';
  copilotModel: string;
  copilotEndpoint: string;
  copilotRole: 'reviewer' | 'security' | 'maintainer' | 'custom';
  copilotInstructions: string;
};

const STORAGE_KEY = 'ming-global-settings-v2';
const LEGACY_STORAGE_KEY = 'ming-global-settings-v1';

export const defaultGlobalSettings: GlobalSettings = {
  codeFontSize: 13, codeLineHeight: 24,
  syntaxHighlighting: true, showLineNumbers: true,
  showReadmePreview: true, filePreviewLimitKb: 500,
  defaultReviewTab: 'changes', expandDiffs: true, richMarkdownByDefault: false,
  copilotProvider: 'openai', copilotModel: '', copilotEndpoint: '',
  copilotRole: 'reviewer', copilotInstructions: '',
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
      codeFontSize: choice(settings.codeFontSize, [12, 13, 14, 15, 16], defaultGlobalSettings.codeFontSize),
      codeLineHeight: choice(settings.codeLineHeight, [20, 24, 28, 32], defaultGlobalSettings.codeLineHeight),
      syntaxHighlighting: flag(settings.syntaxHighlighting, true),
      showLineNumbers: flag(settings.showLineNumbers, true),
      showReadmePreview: flag(settings.showReadmePreview, true),
      filePreviewLimitKb: choice(settings.filePreviewLimitKb, [100, 500, 1000, 2000], defaultGlobalSettings.filePreviewLimitKb),
      defaultReviewTab: choice(settings.defaultReviewTab, ['changes', 'commits'], defaultGlobalSettings.defaultReviewTab),
      expandDiffs: flag(settings.expandDiffs, true),
      richMarkdownByDefault: flag(settings.richMarkdownByDefault, false),
      copilotProvider: choice(settings.copilotProvider, ['openai', 'anthropic', 'google', 'custom'], defaultGlobalSettings.copilotProvider),
      copilotModel: shortText(settings.copilotModel, 120),
      copilotEndpoint: shortText(settings.copilotEndpoint, 500),
      copilotRole: choice(settings.copilotRole, ['reviewer', 'security', 'maintainer', 'custom'], defaultGlobalSettings.copilotRole),
      copilotInstructions: shortText(settings.copilotInstructions, 4000),
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
