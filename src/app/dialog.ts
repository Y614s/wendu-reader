import { shallowRef } from 'vue'

// App 内的确认框，代替系统弹窗：样式跟随主题。同一时间只显示一个，连续调用时依次排队。

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮用红色 */
  danger?: boolean
}

interface Pending {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

const queue: Pending[] = []

/** 正在显示的确认框，App.vue 负责渲染 */
export const activeDialog = shallowRef<ConfirmOptions | null>(null)

let current: Pending | null = null

function showNext() {
  current = queue.shift() ?? null
  activeDialog.value = current?.options ?? null
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ options, resolve })
    if (!current) showNext()
  })
}

export function answerDialog(ok: boolean): void {
  current?.resolve(ok)
  showNext()
}
