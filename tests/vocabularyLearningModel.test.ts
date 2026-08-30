import { describe, expect, it, vi } from 'vitest'
import {
  advanceVocabularyReviewSession,
  buildAnkiTsv,
  buildVocabularyCloze,
  createVocabularyLifecycleGuard,
  createVocabularyReviewSession,
  reconcileVocabularyReviewQueue,
  reconcileVocabularyReviewSession,
  vocabularyImportNeedsConfirmation,
  vocabularyReviewSessionProgress,
  type VocabularyEntry,
} from '@/src/features/vocabulary/learningModel'

const NOW = 10_000

function entry(id: string, overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id,
    identityKey: `en:${id}`,
    sourceLanguage: 'en',
    term: id,
    normalizedTerm: id,
    translations: {},
    phonetic: '',
    partOfSpeech: '',
    contexts: [],
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    encounterCount: 1,
    masteryLevel: 0,
    status: 'new',
    nextReviewAt: NOW,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    schemaVersion: 1,
    ...overrides,
  }
}

describe('vocabulary learning model edge cases', () => {
  it('normalizes empty export cells, invalid sizes and empty cloze inputs', () => {
    expect(buildAnkiTsv([null as unknown as string], [[undefined]])).toBe(
      '#separator:tab\n#html:false\n#columns:\n',
    )
    expect(vocabularyImportNeedsConfirmation(Number.NaN)).toBe(false)
    expect(buildVocabularyCloze('', 'word')).toBe('')
    expect(buildVocabularyCloze('word', '')).toBe('')
  })

  it('deduplicates queue entries and advances non-head or missing entries safely', () => {
    const first = entry('first')
    const second = entry('second')
    expect(reconcileVocabularyReviewQueue([first, first], [first], NOW)).toEqual([first])

    const session = createVocabularyReviewSession([first, second])
    expect(advanceVocabularyReviewSession(session, 'second')).toMatchObject({
      queue: [first],
      completed: 1,
      answerVisible: false,
    })
    expect(advanceVocabularyReviewSession(session, 'missing')).toMatchObject({
      queue: [first, second],
      completed: 0,
      answerVisible: false,
    })
  })

  it('detects each kind of current-card change and preserves an unchanged answer', () => {
    const current = entry('current')
    const session = { queue: [current], completed: 2, answerVisible: true }

    expect(reconcileVocabularyReviewSession(session, [], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('other')], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('current', { updatedAt: 2 })], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('current', { reviewCount: 1 })], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [current], NOW).answerVisible).toBe(true)

    expect(vocabularyReviewSessionProgress({ queue: [], completed: 2, answerVisible: false })).toEqual({
      current: null,
      position: 2,
      total: 2,
    })
  })

  it('runs initialization only while the lifecycle remains active', async () => {
    const initialize = vi.fn()
    const active = createVocabularyLifecycleGuard()
    await expect(active.runAfterReady(Promise.resolve(), initialize)).resolves.toBe(true)
    expect(initialize).toHaveBeenCalledOnce()

    const disposedDuringInitialization = createVocabularyLifecycleGuard()
    await expect(disposedDuringInitialization.runAfterReady(Promise.resolve(), () => {
      disposedDuringInitialization.dispose()
    })).resolves.toBe(false)
  })
})
