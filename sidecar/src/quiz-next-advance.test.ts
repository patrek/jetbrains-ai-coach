/**
 * @vitest-environment jsdom
 *
 * Regression test for the Learning quiz advance flow. Two bugs, same family —
 * Preact reuses the quiz card's DOM nodes across questions, so imperative
 * mutations from answering question N leak onto question N+1:
 *   1. the feedback panel (explanation + Next button) stayed visible, and its
 *      stale Next button re-rendered the current question ("Next does nothing");
 *   2. the choice buttons stayed `disabled` with their correct/wrong classes, so
 *      the next question could not be answered (no answer -> no Next button).
 *
 * Fix: key the quiz card by index in renderQuiz so each question mounts a fresh
 * card (fresh choices, fresh empty feedback). This test drives the real renderQuiz
 * + preact render through a full 3-question walkthrough, mirroring wireQuizHandlers
 * (including the imperative disable-on-answer that exposed bug 2).
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: () => {}, getState: () => null, setState: () => {},
  });
});

describe('quiz advances cleanly through every question', () => {
  it('each question has fresh, clickable choices and no stale feedback', async () => {
    const { renderQuiz } = await import('../vendor/webview/page-learning-templates');
    const { render, html } = await import('../vendor/webview/render');
    type QuizQuestion = Parameters<typeof renderQuiz>[0][number];

    const Q: QuizQuestion[] = [0, 1, 2].map((n) => ({
      question: `Q${n}`, choices: ['a', 'b', 'c', 'd'], correctIndex: 0,
      explanation: `expl ${n}`, difficulty: 'medium', topic: 'markdown',
    }));

    document.body.innerHTML = '<div id="quiz-container"></div>';
    const quizContainer = document.getElementById('quiz-container')!;
    const num = () => quizContainer.querySelector('.learn-quiz-num')?.textContent;
    const choices = () => [...quizContainer.querySelectorAll<HTMLButtonElement>('.learn-quiz-choice')];
    const fb = () => document.getElementById('quiz-feedback')!;

    // Faithful mirror of wireQuizHandlers: on answer, imperatively disable every
    // choice + tag correct/wrong, then render feedback + Next into #quiz-feedback;
    // Next re-renders the card and re-wires.
    const wireQuiz = (currentIndex: number): void => {
      for (const btn of choices()) {
        btn.addEventListener('click', () => {
          for (const b of choices()) {
            b.disabled = true;
            b.classList.add('learn-quiz-choice-correct');
          }
          const feedback = fb();
          feedback.style.display = 'block';
          render(
            html`<strong>Correct!</strong><p>${Q[currentIndex].explanation}</p>
              <button class="learn-quiz-next">Next</button>`,
            feedback,
          );
          feedback.querySelector('.learn-quiz-next')?.addEventListener('click', () => {
            const nextIndex = currentIndex + 1;
            render(renderQuiz(Q, nextIndex), quizContainer);
            if (nextIndex < Q.length) wireQuiz(nextIndex);
          });
        });
      }
    };

    const answer = () => {
      const c = quizContainer.querySelector<HTMLButtonElement>('.learn-quiz-choice')!;
      expect(c.disabled).toBe(false); // must be answerable
      c.dispatchEvent(new window.Event('click', { bubbles: true }));
    };
    const clickNext = () =>
      fb().querySelector<HTMLButtonElement>('.learn-quiz-next')!
        .dispatchEvent(new window.Event('click', { bubbles: true }));

    render(renderQuiz(Q, 0), quizContainer);
    wireQuiz(0);

    // Walk all three questions; each must be fresh and answerable.
    expect(num()).toBe('1/3');
    answer(); clickNext();

    expect(num()).toBe('2/3');
    expect(choices().every((b) => !b.disabled)).toBe(true);       // bug 2: not disabled
    expect(choices().some((b) => b.classList.contains('learn-quiz-choice-correct'))).toBe(false); // no stale class
    expect(fb().textContent?.trim()).toBe('');                    // bug 1: no stale feedback
    expect(fb().querySelector('.learn-quiz-next')).toBeNull();
    answer(); clickNext();

    expect(num()).toBe('3/3');
    expect(choices().every((b) => !b.disabled)).toBe(true);
    answer(); clickNext();

    // Past the last question -> "complete" screen.
    expect(quizContainer.querySelector('#quiz-more-btn')).not.toBeNull();
  });

  it('Code Review ("Slop or Not"): each round has fresh, clickable snippets', async () => {
    const { renderCodeReviewRound } = await import('../vendor/webview/page-learning-templates');
    const { render, html } = await import('../vendor/webview/render');
    type Round = Parameters<typeof renderCodeReviewRound>[0][number];

    const rounds: Round[] = [0, 1, 2].map((n) => ({
      snippetA: `A${n}`, snippetB: `B${n}`, betterSnippet: 'A', title: `T${n}`,
      category: 'readability', explanation: `why ${n}`, difficulty: 'medium', language: 'markdown',
    }));
    const state = { codeReviewTotal: 0, codeReviewCorrect: 0 } as Parameters<typeof renderCodeReviewRound>[2];

    document.body.innerHTML = '<div id="cr-container"></div>';
    const cr = document.getElementById('cr-container')!;
    const num = () => cr.querySelector('.learn-quiz-num')?.textContent;
    const snippets = () => [...cr.querySelectorAll<HTMLElement>('.learn-cr-snippet')];
    const fb = () => document.getElementById('cr-feedback')!;

    // Mirror wireCodeReviewHandlers: on pick, imperatively disable snippets, then
    // render feedback + Next into #cr-feedback; Next re-renders the round.
    const wire = (i: number): void => {
      for (const s of snippets()) {
        s.addEventListener('click', () => {
          for (const x of snippets()) x.classList.add('learn-cr-disabled');
          const f = fb();
          f.style.display = 'block';
          render(html`<p>${rounds[i].explanation}</p><button class="learn-cr-next">Next</button>`, f);
          f.querySelector('.learn-cr-next')?.addEventListener('click', () => {
            render(renderCodeReviewRound(rounds, i + 1, state), cr);
            wire(i + 1);
          });
        });
      }
    };
    const pick = () => {
      const s = snippets()[0];
      expect(s.classList.contains('learn-cr-disabled')).toBe(false); // must be answerable
      s.dispatchEvent(new window.Event('click', { bubbles: true }));
    };
    const next = () => fb().querySelector<HTMLButtonElement>('.learn-cr-next')!
      .dispatchEvent(new window.Event('click', { bubbles: true }));

    render(renderCodeReviewRound(rounds, 0, state), cr);
    wire(0);
    expect(num()).toBe('1/3');
    pick(); next();

    expect(num()).toBe('2/3');
    expect(snippets().every((s) => !s.classList.contains('learn-cr-disabled'))).toBe(true);
    expect(fb().textContent?.trim()).toBe('');
    pick(); next();

    expect(num()).toBe('3/3');
    expect(snippets().every((s) => !s.classList.contains('learn-cr-disabled'))).toBe(true);
  });
});
