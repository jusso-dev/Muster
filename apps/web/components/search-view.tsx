"use client";

import { useState } from "react";
import { FileSearch, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { searchResults } from "@/lib/demo-data";

export function SearchView() {
  const [query, setQuery] = useState("PowerShell 203.0.113.44");
  const [submitted, setSubmitted] = useState(query);
  return <AppShell><PageHeader eyebrow="Security memory" title="Search" description="Organisation-scoped, deterministic full-text search" /><form onSubmit={(event) => { event.preventDefault(); setSubmitted(query); }} className="flex gap-2 border-b bg-[var(--color-paper-2)] p-3"><label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3"><Search className="size-4 text-muted-foreground" /><span className="sr-only">Search Muster</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label><Button type="submit">Search</Button></form><div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5"><div className="mx-auto max-w-4xl"><p className="mb-3 text-xs text-muted-foreground">6 permission-filtered results for <strong className="text-foreground">“{submitted}”</strong></p><div className="divide-y border bg-card">{searchResults.map((result) => <article key={`${result.group}-${result.title}`} className="hover-row p-4"><div className="flex items-center gap-2"><FileSearch className="size-4 text-muted-foreground" /><Badge className="bg-muted text-muted-foreground">{result.group}</Badge><span className="text-[11px] text-muted-foreground">{result.context}</span></div><h2 className="mt-2 text-sm font-semibold">{result.title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{result.snippet}</p></article>)}</div></div></div></AppShell>;
}
