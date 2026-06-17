/**
 * @vitest-environment jsdom
 *
 * Regression test for the quiz "Next does nothing" bug.
 *
 * The quiz feedback (explanation + Next button) is rendered as a SEPARATE Preact
 * root into #quiz-feedback and shown imperatively. Re-rendering the quiz card on
 * advance does NOT clear it (the card's own #quiz-feedback vnode is an empty,
 * display:none leaf), so before the fix the previous question's feedback — and its
 * stale Next button — stayed visible, and clicking that Next re-rendered the
 * current question (looked like nothing happened).
 *
 * This drives the real renderQuiz / render and the real clearQuizFeedback() fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: () => {}, getState: () => null, setState: () => {},
  });
});

describe('quiz Next advances cleanly through all questions', () => {
  it('clears the prior feedback on advance so Next is never stale', async () => {
    const { renderQuiz } = await import('../vendor/webview/page-learning-templates');
    const { render, html } = await import('../vendor/webview/render');
    const { clearQuizFeedback } = await import('../vendor/webview/page-learning');
    type QuizQuestion = Parameters<typeof renderQuiz>[0][number];

    const Q: QuizQuestion[] = [0, 1, 2].map((n) => ({
      question: `Q${n}`, choices: ['a', 'b', 'c', 'd'], correctIndex: 0,
      explanation: `expl ${n}`, difficulty: 'medium', topic: 'markdown',
    }));

    document.body.innerHTML = '<div id="quiz-container"></div>';
    const quizContainer = document.getElementById('quiz-container')!;
    const num = () => quizContainer.querySelector('.learn-quiz-num')?.textContent;
    const fb = () => document.getElementById('quiz-feedback')!;

    // Mirrors wireQuizHandlers: choice listeners only; feedback rendered on click;
    // advance re-renders the card then calls the real clearQuizFeedback().
    const wireQuiz = (currentIndex: number): void => {
      for (const btn of quizContainer.querySelectorAll<HTMLButtonElement>('.learn-quiz-choice')) {
        btn.addEventListener('click', () => {
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
            clearQuizFeedback(); // the fix
            if (nextIndex < Q.length) wireQuiz(nextIndex);
          });
        });
      }
    };

    const answer = () =>
      quizContainer.querySelector<HTMLButtonElement>('.learn-quiz-choice')!
        .dispatchEvent(new window.Event('click', { bubbles: true }));
    const clickNext = () =>
      fb().querySelector<HTMLButtonElement>('.learn-quiz-next')
        ?.dispatchEvent(new window.Event('click', { bubbles: true }));

    // Q0 (1/3) -> answer -> Next.
    render(renderQuiz(Q, 0), quizContainer);
    wireQuiz(0);
    expect(num()).toBe('1/3');
    answer();
    clickNext();

    // At Q1 (2/3) and unanswered: feedback must be cleared, not stale.
    expect(num()).toBe('2/3');
    expect(fb().style.display).toBe('none');
    expect(fb().textContent?.trim()).toBe('');
    expect(fb().querySelector('.learn-quiz-next')).toBeNull();

    // Answer Q1 -> Next -> Q2 (3/3), again clean.
    answer();
    clickNext();
    expect(num()).toBe('3/3');
    expect(fb().style.display).toBe('none');

    // Answer Q2 -> Next -> done screen (More Challenges), no stale quiz card.
    answer();
    clickNext();
    expect(quizContainer.querySelector('#quiz-more-btn')).not.toBeNull();
  });
});
