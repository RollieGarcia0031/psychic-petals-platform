"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock3,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Chapter = {
  id: string;
  chapterNumber: number;
  title: string;
  content: string;
  wordCount?: number;
  lastEdited?: string;
};

type Episode = {
  id: string;
  episodeNumber: number;
  title: string;
  summary?: string;
  published: boolean;
  chapters: Chapter[];
};

type Novel = {
  title: string;
  description?: string;
  author?: string;
  status?: string;
  metadata?: { tags?: string[]; totalWords?: number };
};

const baseNovelId = process.env.NEXT_PUBLIC_NOVEL_ID ?? "psychic_petals";
const defaultLanguage = "en";
const languageStorageKey = "psychic-petals:language";

function novelIdForLanguage(language: string) {
  return language === "en" ? baseNovelId : `${baseNovelId}_${language}`;
}

function sortLanguages(languages: string[]) {
  return [...languages].sort((a, b) => {
    if (a === b) return 0;
    if (a === defaultLanguage) return -1;
    if (b === defaultLanguage) return 1;
    return a.localeCompare(b);
  });
}

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(languageStorageKey);
  } catch {
    return null;
  }
}

function storeLanguage(language: string) {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    return;
  }
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDate(value?: string) {
  if (!value) return "Recently updated";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently updated"
    : `Updated ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

export function NovelReader() {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isContentsOpen, setIsContentsOpen] = useState(false);
  const [language, setLanguage] = useState(defaultLanguage);
  const [languages, setLanguages] = useState<string[]>([defaultLanguage]);
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function discoverLanguages() {
      const stored = readStoredLanguage();

      try {
        const snapshot = await getDocs(collection(db, "novels"));
        const discovered = sortLanguages(
          snapshot.docs
            .map((docSnapshot) => docSnapshot.id)
            .filter((id) => id === baseNovelId || id.startsWith(`${baseNovelId}_`))
            .map((id) =>
              id === baseNovelId ? defaultLanguage : id.slice(baseNovelId.length + 1),
            ),
        );

        if (cancelled) return;

        const available = discovered.length > 0 ? discovered : [defaultLanguage];
        setLanguages(available);
        if (stored && available.includes(stored)) {
          setLanguage(stored);
        }
      } catch {
        if (!cancelled) {
          setLanguages([defaultLanguage]);
        }
      }
    }

    void discoverLanguages();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function loadNovel() {
      const novelId = novelIdForLanguage(language);
      try {
        setIsLoading(true);
        setError(null);
        const novelRef = doc(db, "novels", novelId);
        const novelSnapshot = await getDoc(novelRef);

        if (!novelSnapshot.exists()) {
          throw new Error(`The novel \"${novelId}\" could not be found.`);
        }

        const episodeSnapshot = await getDocs(
          query(collection(novelRef, "episodes"), orderBy("episodeNumber")),
        );

        const loadedEpisodes = await Promise.all(
          episodeSnapshot.docs.map(async (episodeDoc) => {
            const episode = episodeDoc.data() as Omit<Episode, "id" | "chapters">;
            const chapterSnapshot = await getDocs(
              query(collection(episodeDoc.ref, "chapters"), orderBy("chapterNumber")),
            );
            return {
              ...episode,
              id: episodeDoc.id,
              chapters: chapterSnapshot.docs.map((chapterDoc) => ({
                ...(chapterDoc.data() as Omit<Chapter, "id">),
                id: chapterDoc.id,
              })),
            } as Episode;
          }),
        );

        setNovel(novelSnapshot.data() as Novel);
        setEpisodes(loadedEpisodes.filter((episode) => episode.published));
      } catch (loadError) {
        console.error("Unable to load novel from Firestore", loadError);
        setError(loadError instanceof Error ? loadError.message : "Unable to load this novel.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadNovel();
  }, [language]);

  function selectLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    storeLanguage(nextLanguage);
  }

  const chapters = useMemo(
    () => episodes.flatMap((episode) => episode.chapters.map((chapter) => ({ ...chapter, episode }))),
    [episodes],
  );
  const activeIndexSafe = Math.min(activeIndex, Math.max(chapters.length - 1, 0));
  const chapter = chapters[activeIndexSafe];
  const progress = chapters.length ? ((activeIndexSafe + 1) / chapters.length) * 100 : 0;

  useEffect(() => {
    articleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeIndexSafe]);

  function openChapter(index: number) {
    setActiveIndex(index);
    setIsContentsOpen(false);
  }

  return (
    <main className="min-h-screen bg-[#f5f2ec] text-[#201d1b] selection:bg-[#d5b99d]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-56 left-1/2 h-[31rem] w-[31rem] -translate-x-1/2 rounded-full bg-[#e9d8c3]/55 blur-3xl" />
        <div className="absolute bottom-[-12rem] right-[-7rem] h-96 w-96 rounded-full bg-[#d9c9db]/40 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-[#201d1b]/8 bg-[#f5f2ec]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <button className="flex items-center gap-2.5 text-left" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="grid size-9 place-items-center rounded-xl bg-[#2d2926] text-[#f8f5ee] shadow-sm"><Sparkles className="size-4" /></span>
            <span>
              <span className="block font-serif text-base leading-none tracking-tight">{novel?.title ?? "Psychic Petals"}</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#756d66]">Reading room</span>
            </span>
          </button>

          <div className="hidden items-center gap-5 text-xs font-medium text-[#625b55] sm:flex">
            <span>{chapters.length ? `${formatNumber(novel?.metadata?.totalWords)} words` : "A quiet place to read"}</span>
            <span className="size-1 rounded-full bg-[#b7a290]" />
            <span>{novel?.author ?? "Psychic Petals"}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {languages.length > 1 && (
              <Tabs value={language} onValueChange={(value) => selectLanguage(String(value))}>
                <TabsList
                  aria-label="Reading language"
                  className="h-9 rounded-xl border border-[#201d1b]/10 bg-[#fffdf9]/70 p-0.5"
                >
                  {languages.map((code) => (
                    <TabsTrigger
                      key={code}
                      value={code}
                      title={code === "en" ? "English" : code === "tl" ? "Tagalog" : code}
                      className="h-full rounded-lg px-3 text-xs font-semibold uppercase tracking-wide text-[#625b55]"
                    >
                      {code}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <Button variant="outline" size="sm" onClick={() => setIsContentsOpen(true)} className="border-[#201d1b]/10 bg-white/60 px-3 text-[#3c3733] hover:bg-white">
              <Menu data-icon="inline-start" /> Contents
            </Button>
          </div>
        </div>
        <div className="h-px bg-[#201d1b]/8"><div className="h-full bg-[#a56c48] transition-all duration-500" style={{ width: `${progress}%` }} /></div>
      </header>

      <section className="relative mx-auto flex max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <aside className="sticky top-24 hidden h-fit w-64 shrink-0 lg:block">
          <p className="mb-4 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a8077]">Table of contents</p>
          <ChapterList episodes={episodes} activeIndex={activeIndexSafe} onSelect={openChapter} />
        </aside>

        <div className="min-w-0 flex-1">
          {isLoading ? <ReaderLoading /> : error ? <ReaderError message={error} /> : !chapter ? <ReaderEmpty /> : (
            <article ref={articleRef} className="mx-auto max-w-3xl scroll-mt-16">
              <div className="overflow-hidden rounded-[1.75rem] border border-[#201d1b]/8 bg-[#fffdf9] shadow-[0_22px_70px_-30px_rgba(47,35,28,0.28)]">
                <div className="border-b border-[#201d1b]/7 px-7 pb-7 pt-10 sm:px-14 sm:pb-10 sm:pt-16">
                  <div className="mb-5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#a56c48]"><BookOpen className="size-3.5" /> {chapter.episode.title}</div>
                  <p className="font-serif text-sm italic text-[#8a8077]">Chapter {chapter.chapterNumber}</p>
                  <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#8a8077]"><span>{formatNumber(chapter.wordCount)} words</span><span className="hidden size-1 rounded-full bg-[#c5bbb2] sm:block" /><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{formatDate(chapter.lastEdited)}</span></div>
                </div>
                <div className="px-7 pb-9 sm:px-14 sm:py-14">
                  <div className="reader-prose font-serif text-[1.1rem] leading-8 text-[#39332e] sm:text-xl sm:leading-9">
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{chapter.content}</ReactMarkdown>
                  </div>
                </div>
                <div className="flex items-center justify-center border-t border-[#201d1b]/7 px-7 py-5 text-xs font-medium text-[#8a8077]">✦</div>
              </div>
              <nav className="mt-7 flex items-center justify-between gap-3" aria-label="Chapter navigation">
                <Button variant="outline" size="lg" disabled={activeIndexSafe === 0} onClick={() => openChapter(activeIndexSafe - 1)} className="border-[#201d1b]/10 bg-white/60 px-4"><ArrowLeft data-icon="inline-start" /> Previous</Button>
                <span className="text-center text-xs font-medium text-[#837971]">{activeIndexSafe + 1} <span className="text-[#b3aaa2]">/</span> {chapters.length}</span>
                <Button size="lg" disabled={activeIndexSafe === chapters.length - 1} onClick={() => openChapter(activeIndexSafe + 1)} className="bg-[#2d2926] px-4 text-[#fdfaf5] hover:bg-[#4a413b]">Next <ArrowRight data-icon="inline-end" /></Button>
              </nav>
            </article>
          )}
        </div>
      </section>

      {isContentsOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close table of contents" className="absolute inset-0 bg-[#211c18]/25 backdrop-blur-sm" onClick={() => setIsContentsOpen(false)} /><aside className="absolute inset-y-0 right-0 w-[min(23rem,88vw)] overflow-y-auto bg-[#fffdf9] p-5 shadow-2xl"><div className="mb-6 flex items-center justify-between"><span className="font-serif text-xl">Contents</span><Button variant="ghost" size="icon" onClick={() => setIsContentsOpen(false)}><X /></Button></div><ChapterList episodes={episodes} activeIndex={activeIndexSafe} onSelect={openChapter} /></aside></div>}
    </main>
  );
}

function ChapterList({ episodes, activeIndex, onSelect }: { episodes: Episode[]; activeIndex: number; onSelect: (index: number) => void }) {
  let index = 0;
  return <nav className="space-y-5">{episodes.map((episode) => <div key={episode.id}><div className="mb-1 px-3 text-xs font-semibold text-[#5f5750]">{episode.title}</div>{episode.summary && <p className="mb-2 px-3 text-xs leading-5 text-[#9a9088]">{episode.summary}</p>}<div className="space-y-0.5">{episode.chapters.map((chapter) => { const chapterIndex = index++; const active = chapterIndex === activeIndex; return <button key={chapter.id} onClick={() => onSelect(chapterIndex)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${active ? "bg-[#ead9c7] text-[#3a2b20]" : "text-[#736a63] hover:bg-white/80 hover:text-[#332f2c]"}`}><span className="w-5 text-xs tabular-nums text-[#a2968c]">{chapter.chapterNumber}</span><span className="truncate">{chapter.title}</span></button>; })}</div></div>)}</nav>;
}

function ReaderLoading() { return <div className="mx-auto max-w-3xl overflow-hidden rounded-[1.75rem] border border-[#201d1b]/8 bg-[#fffdf9] p-8 shadow-[0_22px_70px_-30px_rgba(47,35,28,0.2)] sm:p-14"><div className="h-4 w-32 animate-pulse rounded bg-[#eee7de]" /><div className="mt-7 h-12 w-3/4 animate-pulse rounded bg-[#eee7de]" /><div className="mt-14 space-y-5">{[1, 2, 3, 4].map((item) => <div key={item} className="h-5 animate-pulse rounded bg-[#f1ebe3]" />)}</div></div>; }
function ReaderError({ message }: { message: string }) { return <Card className="mx-auto max-w-xl border-[#201d1b]/10 bg-[#fffdf9] shadow-[0_22px_70px_-30px_rgba(47,35,28,0.2)]"><CardContent className="px-8 py-10"><Sparkles className="mb-5 size-7 text-[#a56c48]" /><h1 className="font-serif text-3xl">The reading room is waiting</h1><p className="mt-3 leading-7 text-muted-foreground">{message} Add a published novel and its chapters to Firestore, then this page will display each chapter as its own reading page.</p></CardContent></Card>; }
function ReaderEmpty() { return <Card className="mx-auto max-w-xl border-[#201d1b]/10 bg-[#fffdf9]"><CardContent className="px-8 py-10"><BookOpen className="mb-5 size-7 text-[#a56c48]" /><h1 className="font-serif text-3xl">No published chapters yet</h1><p className="mt-3 leading-7 text-muted-foreground">Chapters appear here when their parent episode is marked as published.</p></CardContent></Card>; }
