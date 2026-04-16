import { describe, it, expect } from 'vitest'
import { cleanTitle } from '../text-utils'

describe('cleanTitle', () => {
  it('should remove emojis and symbols from start', () => {
    expect(cleanTitle('ᐈ УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ', 'ddn.ua')).toBe('УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ')
  })

  it('should remove branding suffixes after separators', () => {
    expect(cleanTitle('Machine Learning Q and AI | Sebastian Raschka, PhD', 'sebastianraschka.com'))
      .toBe('Machine Learning Q and AI')
    
    expect(cleanTitle('УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ — DDN.ua', 'ddn.ua'))
      .toBe('УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ')
  })

  it('should handle duplicated info in parentheses', () => {
    expect(cleanTitle('1littlecoder (1littlecoder)', 'huggingface.co')).toBe('1littlecoder')
  })

  it('should remove common marketing phrases (if implemented) or just cleaning', () => {
    // Current heuristic just takes the first part
    expect(cleanTitle('УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ — купить по цене производителя в Киеве DDN.ua', 'ddn.ua'))
      .toBe('УГЛОВЫЕ МОДУЛЬНЫЕ ДИВАНЫ')
  })

  it('should be case-insensitive when removing domain naming', () => {
    expect(cleanTitle('Diveni — ddn.ua', 'ddn.ua')).toBe('Diveni')
    expect(cleanTitle('Diveni - DDN.ua', 'ddn.ua')).toBe('Diveni')
  })

  it('should handle multiple symbols and whitespace', () => {
    expect(cleanTitle('  ➤➤ Awesome Article !!  ', 'example.com')).toBe('Awesome Article')
  })
})
