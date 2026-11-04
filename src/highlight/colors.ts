// 划线颜色。颜色值固定四种，存在 highlights.color 里；名称可以在设置里改。

export const HIGHLIGHT_COLORS = ['yellow', 'blue', 'green', 'red'] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_COLOR: HighlightColor = 'yellow'
/** 红色划线进疑问清单 */
export const QUESTION_COLOR: HighlightColor = 'red'

export const DEFAULT_COLOR_NAMES: Record<HighlightColor, string> = { yellow: '重点', blue: '概念', green: '想法', red: '疑问' }

export const MAX_COLOR_NAME = 10

export type ColorNames = Partial<Record<HighlightColor, string>>

/** 读到不认识的颜色时按默认色显示，不改数据 */
export function normalizeColor(c: string | null | undefined): HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(c ?? '') ? (c as HighlightColor) : DEFAULT_COLOR
}

/** 颜色的显示名称；自定义名称留空时用默认名称 */
export function colorName(c: string | null | undefined, custom?: ColorNames): string {
  const color = normalizeColor(c)
  return custom?.[color]?.trim() || DEFAULT_COLOR_NAMES[color]
}
