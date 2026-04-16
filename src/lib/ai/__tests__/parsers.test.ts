import { describe, it, expect } from 'vitest'
import { parseLlmJson, repairJsonString, extractJson } from '../parsers'

describe('parsers', () => {
  describe('extractJson', () => {
    it('should extract JSON from markdown code blocks', () => {
      const input = 'Here is the data:\n```json\n{"key": "value"}\n```\nHope it helps.'
      expect(extractJson(input)).toBe('{"key": "value"}')
    })

    it('should extract JSON from plain code blocks', () => {
      const input = '```\n[1, 2, 3]\n```'
      expect(extractJson(input)).toBe('[1, 2, 3]')
    })

    it('should return original string if no blocks found', () => {
      const input = '{"a": 1}'
      expect(extractJson(input)).toBe('{"a": 1}')
    })
  })

  describe('repairJsonString', () => {
    it('should add quotes to unquoted keys', () => {
      const input = '{name: "John", age: 30}'
      expect(repairJsonString(input)).toBe('{"name": "John", "age": 30}')
    })

    it('should fix single quotes', () => {
      const input = "{'key': 'value'}"
      expect(repairJsonString(input)).toBe('{"key": "value"}')
    })

    it('should remove trailing commas in objects', () => {
      const input = '{"a": 1, "b": 2,}'
      expect(repairJsonString(input)).toBe('{"a": 1, "b": 2}')
    })

    it('should remove trailing commas in arrays', () => {
      const input = '[1, 2, 3,]'
      expect(repairJsonString(input)).toBe('[1, 2, 3]')
    })

    it('should handle complex mixed cases', () => {
      const input = "{ items: [ { id: 1, name: 'first', }, { id: 2, name: 'second' } ], }"
      const repaired = repairJsonString(input)
      expect(JSON.parse(repaired)).toEqual({
        items: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      })
    })
  })

  describe('parseLlmJson', () => {
    it('should parse valid JSON correctly', () => {
      expect(parseLlmJson('{"ok": true}')).toEqual({ ok: true })
    })

    it('should parse JSON wrapped in markdown with repairs', () => {
      const input = 'Result:\n```json\n{ success: true, tags: ["ai", "test",], }\n```'
      expect(parseLlmJson(input)).toEqual({ success: true, tags: ["ai", "test"] })
    })

    it('should return null for completely invalid input', () => {
      expect(parseLlmJson('not a json at all')).toBeNull()
    })
  })
})
