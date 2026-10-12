import { expect, test } from 'claude-code/testing'

import { parse, spans, wrapSpans } from '../hooks/markdown'

const SAMPLE = `# 標題一
說明文字有 **粗體**、*斜體*、\`inline code\` 和 [連結](https://example.com)。
第二行接在同一段。

## 小節

- 第一項
  續行
- [x] 完成的事
  - 巢狀

1. 一
2. 二

> 引用的話

| 名稱 | 說明 |
| --- | --- |
| foot | 終端機 |

\`\`\`ts
const a = 1
\`\`\`

---
`

test('parse 拆出每種區塊', () => {
  expect(parse(SAMPLE).map(b => b.kind)).toEqual([
    'heading', 'paragraph', 'heading', 'list', 'list', 'quote', 'table', 'code', 'rule',
  ])
  const para = parse(SAMPLE)[1]
  expect(para?.kind === 'paragraph' && para.text.endsWith('。第二行接在同一段。')).toBe(true)
})

test('行內語法', () => {
  const s = spans('a **b *c* b** `d` [e](https://x.y)')
  expect(s.find(x => x.text === 'c')).toMatchObject({ bold: true, italic: true })
  expect(s.find(x => x.text === 'd')).toMatchObject({ code: true })
  expect(s.find(x => x.text === 'e')).toMatchObject({ href: 'https://x.y' })
  expect(spans('snake_case_name').length).toBe(1)
})

test('完整樣本在終端機畫得出來', async $ => {
  const ui = await $.ui.mount({
    plugin: 'aurora',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: SAMPLE, isFirstOfReply: true },
  })
  await ui.resize({ columns: 80, rows: 60 })
  const all = (await ui.find({ type: 'Box', in: 'reply' }))?.text ?? ''
  for (const part of ['標題一', '━', '粗體', ' inline code ', '•', '☑', '▎', '終端機', '───'])
    expect(all).toContain(part)
  expect(await ui.find({ type: 'Code', in: 'reply' })).toBeDefined()
})

test('wrapSpans 中文任意處可斷、英文單字不拆、句讀不落行首', () => {
  const lines = wrapSpans(spans('字形交給 fcft 函式庫快取，捲動時直接搬移'), 20)
  const text = lines.map(l => l.map(s => s.text).join(''))
  expect(text[0]).toBe('字形交給 fcft 函式庫')
  expect(text.every(t => !/^[，。]/.test(t))).toBe(true)
  expect(text.join('')).toBe('字形交給 fcft 函式庫快取，捲動時直接搬移')
})
