import { useEffect, useRef, useState } from 'react'
import type { Episode } from '@woyomi/core'
import { useT } from '../../i18n'
import { Btn } from '../../components'
import { Icon } from '../../icons'

export interface ChapterClosureCardProps {
  chapter?: Episode
  nextEpisode?: Episode
  autoNext?: boolean
  canAutoAdvance?: boolean
  onNext?: () => void
  onRestart?: () => void
  onBackToSeries?: () => void
  isVirtualPage?: boolean
  className?: string
}

const COUNTDOWN_SECONDS = 5

export function ChapterClosureCard({
  chapter,
  nextEpisode,
  autoNext = false,
  canAutoAdvance = true,
  onNext,
  onRestart,
  onBackToSeries,
  isVirtualPage = false,
  className = ''
}: ChapterClosureCardProps) {
  const t = useT()
  const cardRef = useRef<HTMLDivElement>(null)
  const [isInView, setIsInView] = useState(isVirtualPage)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const cancelledRef = useRef(false)

  // Track if card is visibly in the viewport for scrollable readers (Continuous/Novel)
  useEffect(() => {
    if (isVirtualPage) {
      setIsInView(true)
      return
    }
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsInView(false)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsInView(entry.isIntersecting)
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isVirtualPage])

  // Initiate countdown ONLY when the card is both in view and scroll position is at the end
  useEffect(() => {
    if (!isInView || !canAutoAdvance || !autoNext || !nextEpisode || !onNext || cancelledRef.current) {
      setSecondsLeft(null)
      return
    }
    setSecondsLeft(COUNTDOWN_SECONDS)
  }, [isInView, canAutoAdvance, autoNext, nextEpisode, onNext])

  // Timer countdown
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || !onNext) return
    const timer = window.setTimeout(() => {
      if (secondsLeft === 1) {
        onNext()
      } else {
        setSecondsLeft((s) => (s !== null ? s - 1 : null))
      }
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [secondsLeft, onNext])

  const cancelAutoNext = () => {
    cancelledRef.current = true
    setSecondsLeft(null)
  }

  const chapterTitle = chapter
    ? `${t('common.chapter', { number: chapter.number })}${chapter.season != null ? t('common.season', { season: chapter.season }) : ''}${
        chapter.title ? t('common.title', { title: chapter.title }) : ''
      }`
    : ''

  const nextTitle = nextEpisode
    ? `${t('common.chapter', { number: nextEpisode.number })}${nextEpisode.season != null ? t('common.season', { season: nextEpisode.season }) : ''}${
        nextEpisode.title ? t('common.title', { title: nextEpisode.title }) : ''
      }`
    : ''

  return (
    <div
      ref={cardRef}
      className={`flex flex-col items-center justify-center text-center select-none ${
        isVirtualPage ? 'h-full min-h-full w-full p-6 sm:p-10' : 'my-12 px-4 py-8'
      } ${className}`}
    >
      <div className="w-full max-w-md rounded-3xl border border-line-soft bg-surface/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        {/* Completion Icon & Heading */}
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-ok-soft text-ok shadow-inner">
          <Icon name="check" size={28} />
        </div>
        <h2 className="mt-4 text-xl font-extrabold tracking-tight text-fg md:text-2xl">
          {chapter ? t('reader.chapterCompleted', { number: chapter.number }) : t('reader.endOfChapter')}
        </h2>
        {chapter?.title && <p className="mt-1 line-clamp-2 text-xs font-medium text-muted">{chapterTitle}</p>}

        {/* Next Chapter Preview or Caught-Up State */}
        {nextEpisode ? (
          <div className="mt-6 rounded-2xl border border-line bg-surface-2/80 p-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
                {t('reader.nextChapterTitle', { number: nextEpisode.number })}
              </span>
              {secondsLeft !== null && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
                  {t('reader.nextIn', { seconds: secondsLeft })}
                </span>
              )}
            </div>
            {nextEpisode.title && (
              <p className="mt-1 truncate text-sm font-bold text-fg">{nextTitle}</p>
            )}

            {/* Countdown progress bar */}
            {secondsLeft !== null && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                  style={{ width: `${((COUNTDOWN_SECONDS - secondsLeft + 1) / COUNTDOWN_SECONDS) * 100}%` }}
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Btn
                variant="primary"
                onClick={onNext}
                className="flex-1 gap-2 text-xs font-bold"
              >
                <span>{secondsLeft !== null ? t('reader.readNextNow') : t('reader.readNextChapter')}</span>
                <Icon name="chevronRight" size={15} />
              </Btn>
              {secondsLeft !== null && (
                <Btn
                  variant="soft"
                  onClick={cancelAutoNext}
                  className="px-3 text-xs"
                >
                  {t('reader.cancelAutoAdvance')}
                </Btn>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-line bg-surface-2/80 p-5 text-center">
            <div className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="bookOpen" size={20} />
            </div>
            <p className="font-bold text-fg">{t('reader.caughtUpTitle')}</p>
            <p className="mt-1 text-xs text-muted">{t('reader.caughtUpHint')}</p>
          </div>
        )}

        {/* Secondary navigation actions */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-line-soft pt-5">
          {onBackToSeries && (
            <Btn variant="soft" onClick={onBackToSeries} className="gap-1.5 text-xs">
              <Icon name="back" size={14} />
              {t('reader.returnToSeries')}
            </Btn>
          )}
          {onRestart && (
            <Btn variant="ghost" onClick={onRestart} className="gap-1.5 text-xs text-muted hover:text-fg">
              <Icon name="refresh" size={14} />
              {t('reader.restartChapter')}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}
