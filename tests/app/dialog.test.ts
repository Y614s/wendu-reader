import { describe, expect, it } from 'vitest'
import { activeDialog, answerDialog, confirmDialog } from '../../src/app/dialog'

describe('确认框', () => {
  it('确认和取消的结果正确，答完后关闭', async () => {
    const yes = confirmDialog({ title: '删除？' })
    expect(activeDialog.value?.title).toBe('删除？')
    answerDialog(true)
    expect(await yes).toBe(true)
    expect(activeDialog.value).toBeNull()

    const no = confirmDialog({ title: '删除？' })
    answerDialog(false)
    expect(await no).toBe(false)
  })

  it('危险样式传给界面', () => {
    void confirmDialog({ title: '清除', danger: true })
    expect(activeDialog.value?.danger).toBe(true)
    answerDialog(false)
  })

  it('连续调用依次显示，答案不串', async () => {
    const first = confirmDialog({ title: '第一个' })
    const second = confirmDialog({ title: '第二个' })
    expect(activeDialog.value?.title).toBe('第一个')
    answerDialog(true)
    expect(activeDialog.value?.title).toBe('第二个')
    answerDialog(false)
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(activeDialog.value).toBeNull()
  })

  it('没有确认框时回答不出错', () => {
    expect(() => answerDialog(true)).not.toThrow()
  })
})
