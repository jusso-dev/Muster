"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSearch, Search, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { removeSearchFilter, type SearchFilterName } from "@/lib/search-query";

interface SearchResult {
  id: string;
  type: string;
  title: string;
  roomId: string;
  roomName: string;
  roomSlug: string;
  actorName: string | null;
  createdAt: string;
  rank: number;
}

interface ActiveFilter {
  name: SearchFilterName;
  value: string;
  label: string;
}

interface SearchResponse {
  data?: SearchResult[];
  filters?: ActiveFilter[];
  detail?: string;
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);

  const search = useCallback(async (rawQuery: string) => {
    const requestId = ++requestSequence.current;
    const trimmed = rawQuery.trim();
    setSubmitted(trimmed);
    setError("");
    if (!trimmed) {
      setResults([]);
      setFilters([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/search?q=${encodeURIComponent(trimmed)}`,
      );
      const body = (await response.json()) as SearchResponse;
      if (requestId !== requestSequence.current) return;
      if (!response.ok) {
        setResults([]);
        setFilters([]);
        setError(body.detail ?? "Search could not be completed.");
        return;
      }
      setResults(body.data ?? []);
      setFilters(body.filters ?? []);
    } catch {
      if (requestId !== requestSequence.current) return;
      setResults([]);
      setFilters([]);
      setError("Search could not be completed. Check your connection.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  const navigate = useCallback(
    (rawQuery: string, mode: "push" | "replace") => {
      const trimmed = rawQuery.trim();
      const url = trimmed
        ? `/search?q=${encodeURIComponent(trimmed)}`
        : "/search";
      window.history[`${mode}State`]({}, "", url);
      void search(trimmed);
    },
    [search],
  );

  useEffect(() => {
    const initialQuery =
      new URL(window.location.href).searchParams.get("q") ?? "";
    setQuery(initialQuery);
    void search(initialQuery);
    const handlePopState = () => {
      const restored =
        new URL(window.location.href).searchParams.get("q") ?? "";
      setQuery(restored);
      void search(restored);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [search]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operate"
        title="Search"
        description="Organisation-scoped, permission-filtered search"
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          navigate(query, "push");
        }}
        className="border-b bg-[var(--color-paper-2)] p-3"
      >
        <div className="flex gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3">
            <Search className="size-4 text-muted-foreground" />
            <span className="sr-only">Search Muster</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or filter with from:, in:, after:, before:"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>
        {filters.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-2"
            aria-label="Active search filters"
          >
            {filters.map((filter) => (
              <button
                key={filter.name}
                type="button"
                onClick={() => {
                  const nextQuery = removeSearchFilter(query, filter.name);
                  setQuery(nextQuery);
                  navigate(nextQuery, "push");
                }}
                className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
                aria-label={`Remove ${filter.name} filter`}
              >
                {filter.name}:{filter.label}
                <X className="size-3" />
              </button>
            ))}
          </div>
        ) : null}
      </form>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-4xl">
          {error ? (
            <div
              role="alert"
              className="mb-3 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}
          <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
            {loading
              ? "Searching permission-filtered activity…"
              : `${results.length} permission-filtered result${results.length === 1 ? "" : "s"}`}
            {!loading && submitted ? (
              <>
                {" "}
                for <strong className="text-foreground">“{submitted}”</strong>
              </>
            ) : null}
          </p>
          {!loading && results.length > 0 ? (
            <div
              className="divide-y border bg-card"
              data-testid="search-results"
            >
              {results.map((result) => (
                <article
                  key={`${result.type}-${result.id}`}
                  className="hover-row p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <FileSearch className="size-4 text-muted-foreground" />
                    <Badge className="bg-muted text-muted-foreground">
                      {result.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {result.roomName}
                      {result.actorName ? ` · ${result.actorName}` : ""}
                      {" · "}
                      {new Date(result.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="mt-2 text-sm font-semibold">{result.title}</h2>
                </article>
              ))}
            </div>
          ) : !loading && !error ? (
            <div className="border border-dashed p-10 text-center">
              <FileSearch className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-bold">
                {submitted ? "No matching activity" : "Search your workspace"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {submitted
                  ? "Try different terms or remove a filter."
                  : "Use text, from:, in:, after:, and before: filters."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
