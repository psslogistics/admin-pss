"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, Ruler, Trash2, Upload, X } from "lucide-react";

type Dimension = { length: string; width: string; height: string };
type DimensionMode = "same" | "individual";

export type ShipmentBooking = {
  clientName: string;
  description: string;
  weight: string;
  pieces: string;
  value: string;
  invoices: File[];
  dimensionMode: DimensionMode;
  dimensions: Dimension[];
};

type Props = { clientName: string; onCancel: () => void; onSubmit: (booking: ShipmentBooking) => void };
const field = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10";
const emptyDimension = (): Dimension => ({ length: "", width: "", height: "" });
const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
const isPositive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;

export default function ShipmentBookingForm({ clientName, onCancel, onSubmit }: Props) {
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [pieces, setPieces] = useState("1");
  const [value, setValue] = useState("");
  const [invoices, setInvoices] = useState<File[]>([]);
  const [dimensionMode, setDimensionMode] = useState<DimensionMode>("same");
  const [dimensions, setDimensions] = useState<Dimension[]>([emptyDimension()]);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ShipmentBooking | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const count = Math.max(1, Math.floor(Number(pieces) || 1));
    setDimensions((current) => Array.from({ length: count }, (_, index) => current[index] ?? emptyDimension()));
  }, [pieces]);

  const updateDimension = (index: number, key: keyof Dimension, nextValue: string) => {
    setDimensions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item));
  };

  const addInvoices = (files: FileList | null) => {
    if (!files) return;
    const nextFiles = Array.from(files);
    const invalid = nextFiles.find((file) => (!allowedTypes.includes(file.type) && !allowedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))) || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} must be a PDF, JPG, or PNG up to 10 MB.`);
      return;
    }
    setInvoices((current) => [...current, ...nextFiles]);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(pieces);
    if (!description.trim() || !isPositive(weight) || !Number.isInteger(count) || count < 1 || !isPositive(value)) {
      setError("Complete the shipment description, weight, box count, and shipment value.");
      return;
    }
    if (!invoices.length) {
      setError("Upload at least one invoice for this shipment.");
      return;
    }
    const requiredDimensions = dimensionMode === "same" ? dimensions.slice(0, 1) : dimensions.slice(0, count);
    if (requiredDimensions.some((item) => !isPositive(item.length) || !isPositive(item.width) || !isPositive(item.height))) {
      setError("Enter positive length, width, and height values for every box.");
      return;
    }
    setReview({ clientName, description: description.trim(), weight, pieces: String(count), value, invoices, dimensionMode, dimensions: requiredDimensions });
  };

  const dimensionFields = (dimension: Dimension, index: number) => <div key={index} className="grid grid-cols-3 gap-2"><label className="sr-only" htmlFor={`length-${index}`}>Box {index + 1} length in centimetres</label><input id={`length-${index}`} required type="number" min="0.1" step="0.1" placeholder="Length" value={dimension.length} onChange={(event) => updateDimension(index, "length", event.target.value)} className={field} /><label className="sr-only" htmlFor={`width-${index}`}>Box {index + 1} width in centimetres</label><input id={`width-${index}`} required type="number" min="0.1" step="0.1" placeholder="Width" value={dimension.width} onChange={(event) => updateDimension(index, "width", event.target.value)} className={field} /><label className="sr-only" htmlFor={`height-${index}`}>Box {index + 1} height in centimetres</label><input id={`height-${index}`} required type="number" min="0.1" step="0.1" placeholder="Height" value={dimension.height} onChange={(event) => updateDimension(index, "height", event.target.value)} className={field} /></div>;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" role="presentation" onClick={onCancel}><section role="dialog" aria-modal="true" aria-labelledby="shipment-booking-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/70 p-5"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Frontend booking workflow</p><h2 id="shipment-booking-title" className="mt-1 text-lg font-semibold">Book shipment</h2><p className="mt-1 text-xs text-muted-foreground">{clientName} · invoices and box dimensions are kept with this shipment.</p></div><button type="button" aria-label="Close shipment booking" onClick={onCancel} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button></div><form onSubmit={submit} className="min-h-0 overflow-y-auto p-5"><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold">What are you shipping?</span><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Shipment description" className={field} /></label><label><span className="mb-1.5 block text-xs font-semibold">Total weight</span><div className="relative"><input required type="number" min="0.1" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Weight" className={`${field} pr-12`} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kg</span></div></label><label><span className="mb-1.5 block text-xs font-semibold">Number of boxes</span><input required type="number" min="1" step="1" value={pieces} onChange={(event) => setPieces(event.target.value)} className={field} /></label><label><span className="mb-1.5 block text-xs font-semibold">Shipment value</span><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span><input required type="number" min="0.1" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Declared value" className={`${field} pl-7`} /></div></label></div>

<section className="mt-5 rounded-xl border border-border/70 p-4"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="size-4" /></span><div><h3 className="text-sm font-semibold">Shipment invoices</h3><p className="mt-1 text-xs text-muted-foreground">Upload one or more invoices for this shipment. PDF, JPG, or PNG · max 10 MB each.</p></div></div><input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(event) => addInvoices(event.target.files)} /><button type="button" onClick={() => fileInput.current?.click()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 text-xs font-semibold text-primary hover:border-primary"><Upload className="size-3.5" /> Add invoice files</button>{invoices.length > 0 && <div className="mt-3 space-y-2">{invoices.map((invoice, index) => <div key={`${invoice.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs"><FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{invoice.name}</span><button type="button" aria-label={`Remove ${invoice.name}`} onClick={() => setInvoices((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button></div>)}</div>}</section>

<section className="mt-4 rounded-xl border border-border/70 p-4"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600"><Ruler className="size-4" /></span><div><h3 className="text-sm font-semibold">Shipment dimensions</h3><p className="mt-1 text-xs text-muted-foreground">Enter box dimensions in centimetres. Box count: {pieces || "0"}.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-1"><button type="button" onClick={() => setDimensionMode("same")} className={`rounded-md px-3 py-2 text-xs font-semibold transition ${dimensionMode === "same" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Same for all boxes</button><button type="button" onClick={() => setDimensionMode("individual")} className={`rounded-md px-3 py-2 text-xs font-semibold transition ${dimensionMode === "individual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Individual per box</button></div><div className="mt-4 space-y-2"><div className="grid grid-cols-3 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Length (cm)</span><span>Width (cm)</span><span>Height (cm)</span></div>{dimensionMode === "same" ? dimensionFields(dimensions[0] ?? emptyDimension(), 0) : dimensions.map((dimension, index) => <div key={index} className="flex items-center gap-2"><span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">Box {index + 1}</span><div className="min-w-0 flex-1">{dimensionFields(dimension, index)}</div></div>)}</div></section>

{error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><X className="mt-0.5 size-3.5 shrink-0" />{error}</div>}{review && <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4"><div className="flex items-center gap-2"><Check className="size-4 text-primary" /><h3 className="text-sm font-semibold">Review booking</h3></div><div className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><p className="text-muted-foreground">Client</p><p className="mt-1 font-semibold">{review.clientName}</p></div><div><p className="text-muted-foreground">Shipment</p><p className="mt-1 font-semibold">{review.description} · {review.pieces} box{Number(review.pieces) === 1 ? "" : "es"} · {review.weight} kg · ₹{review.value}</p></div><div className="sm:col-span-2"><p className="text-muted-foreground">Invoices ({review.invoices.length})</p><p className="mt-1 break-words font-semibold">{review.invoices.map((invoice) => invoice.name).join(" · ")}</p></div><div className="sm:col-span-2"><p className="text-muted-foreground">Dimensions</p><p className="mt-1 font-semibold">{review.dimensionMode === "same" ? `${review.dimensions[0].length} × ${review.dimensions[0].width} × ${review.dimensions[0].height} cm each` : review.dimensions.map((item, index) => `Box ${index + 1}: ${item.length} × ${item.width} × ${item.height} cm`).join(" · ")}</p></div></div></div>}<div className="mt-5 flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={review ? () => setReview(null) : onCancel} className="h-10 rounded-lg border border-input px-4 text-xs font-semibold hover:bg-accent">{review ? "Back to edit" : "Cancel"}</button>{review ? <button type="button" onClick={() => onSubmit(review)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><Check className="size-3.5" /> Confirm booking</button> : <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><Check className="size-3.5" /> Review booking</button>}</div></form></section></div>;
}
