import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, FileText, AlertTriangle, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface ParsedProduct {
  name: string;
  sku: string | null;
  description: string | null;
  cost: number;
  price: number;
  stock: number;
  brand: string | null;
  supplier_url?: string | null;
  _source?: string;
  _selected?: boolean;
}

type WizardStep = "parsing" | "analyzing" | "review";

interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
  files: File[];
  onConfirmImport: (products: ParsedProduct[], files: File[]) => Promise<void>;
}

// Helpers copied from Catalog (keep in sync)
const normalizeHeader = (h: unknown) =>
  String(h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

const parseNum = (val: unknown): number => {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  let s = String(val).replace(/\s/g, "").replace(/[R$€]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) s = s.replace(/,/g, "");
  return parseFloat(s) || 0;
};

const findVal = (row: Record<string, string>, keys: string[]): string => {
  const normalizedKeys = keys.map(normalizeHeader);
  for (const rk of Object.keys(row)) {
    const nh = normalizeHeader(rk);
    if (normalizedKeys.some((k) => nh.includes(k))) return row[rk];
  }
  return "";
};

const detectHeaderRowIndex = (rowsMatrix: unknown[][]) => {
  const headerHints = [
    "description", "descricao", "designacao", "name", "nome", "ref", "referencia", "sku",
    "tarif", "cost", "custo", "price", "preco", "pvp", "stock", "quantidade", "qty",
  ];
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(40, rowsMatrix.length); i++) {
    const row = (rowsMatrix[i] || []) as unknown[];
    const cells = row.map((c) => normalizeHeader(c)).filter(Boolean);
    if (cells.length < 2) continue;
    const hintScore = cells.reduce((acc: number, cell: string) => {
      const matchesHint = headerHints.some((hint) => cell.includes(hint));
      return acc + (matchesHint ? 3 : /[a-zA-ZÀ-ÿ]/.test(cell) ? 1 : 0);
    }, 0);
    if (hintScore > bestScore) { bestScore = hintScore; bestIndex = i; }
  }
  if (bestScore > 0) return bestIndex;
  for (let i = 0; i < Math.min(20, rowsMatrix.length); i++) {
    const row = (rowsMatrix[i] || []) as unknown[];
    const nonEmpty = row.filter((c) => String(c || "").trim().length > 0).length;
    const hasText = row.some((c) => typeof c === "string" && c.trim().length > 1 && Number.isNaN(Number(c)));
    if (nonEmpty >= 3 && hasText) return i;
  }
  return 0;
};

async function parseExcelFile(file: File): Promise<ParsedProduct[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const allProducts: ParsedProduct[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    const headerRowIdx = detectHeaderRowIndex(allRows as unknown[][]);
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", range: headerRowIdx });

    for (const r of jsonData) {
      const row: Record<string, string> = {};
      Object.keys(r).forEach((k) => { row[String(k).trim()] = String(r[k] ?? "").trim(); });

      const directName = findVal(row, ["description", "descricao", "name", "nome", "titulo", "title", "produto", "designacao"]);
      const fallbackName = Object.values(row).find((v) => {
        const value = String(v || "").trim();
        return value.length > 2 && /[a-zA-ZÀ-ÿ]/.test(value) && !/^\d+$/.test(value);
      }) || "";
      const name = (directName || fallbackName).trim();
      if (!name) continue;

      allProducts.push({
        name,
        sku: findVal(row, ["ref", "sku", "referencia", "codigo", "code", "cod"]) || null,
        description: null,
        cost: parseNum(findVal(row, ["cost", "custo", "tarif", "preco custo", "net", "euro"])),
        price: parseNum(findVal(row, ["price", "preco", "pvp", "sell", "venda"])),
        stock: Math.max(0, Math.trunc(parseNum(findVal(row, ["stock", "estoque", "qty", "quantidade", "std", "units"])))),
        brand: findVal(row, ["brand", "marca"]) || null,
        supplier_url: findVal(row, ["supplier_url", "url", "fornecedor_url"]) || null,
        _source: file.name,
      });
    }
  }

  return allProducts;
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim()); current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

async function parseCsvFile(file: File): Promise<ParsedProduct[]> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter);
  const products: ParsedProduct[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });

    const name = findVal(row, ["description", "descricao", "name", "nome", "titulo", "title", "produto", "designacao"]).trim();
    if (!name) continue;

    products.push({
      name,
      sku: findVal(row, ["ref", "sku", "referencia", "codigo", "code", "cod"]) || null,
      description: null,
      cost: parseNum(findVal(row, ["cost", "custo", "tarif", "preco custo", "net", "euro"])),
      price: parseNum(findVal(row, ["price", "preco", "pvp", "sell", "venda"])),
      stock: Math.max(0, Math.trunc(parseNum(findVal(row, ["stock", "estoque", "qty", "quantidade"])))),
      brand: findVal(row, ["brand", "marca"]) || null,
      _source: file.name,
    });
  }

  return products;
}

async function parsePdfFile(file: File): Promise<ParsedProduct[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  if (!fullText.trim()) return [];

  const { data, error } = await supabase.functions.invoke("extract-products", { body: { text: fullText } });
  if (error || !data?.success) return [];

  return (data.products || []).map((p: any) => ({
    name: String(p?.name || "").trim(),
    sku: p?.sku || null,
    description: p?.description || null,
    cost: parseNum(p?.cost),
    price: parseNum(p?.price),
    stock: Math.max(0, Math.trunc(parseNum(p?.stock))),
    brand: p?.brand || null,
    _source: file.name,
  })).filter((p: ParsedProduct) => p.name.length > 0);
}

export function ImportWizard({ open, onClose, files, onConfirmImport }: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>("parsing");
  const [parseProgress, setParseProgress] = useState(0);
  const [parsedDatasets, setParsedDatasets] = useState<{ source: string; products: ParsedProduct[] }[]>([]);
  const [mergedProducts, setMergedProducts] = useState<ParsedProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open && files.length > 0) {
      setStep("parsing");
      setParseProgress(0);
      setParsedDatasets([]);
      setMergedProducts([]);
      setSelectedIds(new Set());
      setSearchTerm("");
      setError(null);
      setImporting(false);
      startParsing();
    }
  }, [open]);

  const startParsing = async () => {
    setStep("parsing");
    setError(null);
    const datasets: { source: string; products: ParsedProduct[] }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop()?.toLowerCase();
      setParseProgress(Math.round(((i) / files.length) * 100));

      try {
        let products: ParsedProduct[] = [];
        if (ext === "xlsx" || ext === "xls") {
          products = await parseExcelFile(file);
        } else if (ext === "csv") {
          products = await parseCsvFile(file);
        } else if (ext === "pdf") {
          products = await parsePdfFile(file);
        }
        if (products.length > 0) {
          datasets.push({ source: file.name, products });
        }
      } catch (e: any) {
        console.error(`Error parsing ${file.name}:`, e);
      }

      setParseProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setParsedDatasets(datasets);

    if (datasets.length === 0) {
      setError("Nenhum produto encontrado nos ficheiros carregados.");
      return;
    }

    // Move to analysis step
    if (datasets.length === 1) {
      // Single file - skip merge, go directly to review
      const products = datasets[0].products;
      setMergedProducts(products);
      setSelectedIds(new Set(products.map((_, i) => i)));
      setStep("review");
    } else {
      // Multiple files - merge with AI
      setStep("analyzing");
      try {
        const { data, error: mergeError } = await supabase.functions.invoke("merge-products", {
          body: { datasets: datasets.map((ds) => ({ source: ds.source, products: ds.products.slice(0, 500) })) },
        });

        if (mergeError) throw mergeError;

        if (data?.success && Array.isArray(data.products)) {
          const products = data.products.map((p: any) => ({
            name: String(p?.name || "").trim(),
            sku: p?.sku || null,
            description: p?.description || null,
            cost: parseNum(p?.cost),
            price: parseNum(p?.price),
            stock: Math.max(0, Math.trunc(parseNum(p?.stock))),
            brand: p?.brand || null,
            _source: "merged",
          })).filter((p: ParsedProduct) => p.name.length > 0);

          setMergedProducts(products);
          setSelectedIds(new Set(products.map((_: any, i: number) => i)));
          setStep("review");
        } else {
          throw new Error("Falha na análise. A usar dados sem fusão.");
        }
      } catch (e: any) {
        console.warn("Merge failed, falling back to concatenation:", e);
        // Fallback: simple client-side dedup
        const allProducts = datasets.flatMap((ds) => ds.products);
        const deduped = clientSideDedup(allProducts);
        setMergedProducts(deduped);
        setSelectedIds(new Set(deduped.map((_, i) => i)));
        setStep("review");
      }
    }
  };

  const clientSideDedup = (products: ParsedProduct[]): ParsedProduct[] => {
    const seen = new Map<string, ParsedProduct>();
    for (const p of products) {
      const key = (p.sku ?? "").toLowerCase() + "|" + p.name.toLowerCase().substring(0, 40);
      const existing = seen.get(key);
      if (existing) {
        // Merge: take most complete data
        if (!existing.description && p.description) existing.description = p.description;
        if (!existing.cost && p.cost) existing.cost = p.cost;
        if (!existing.price && p.price) existing.price = p.price;
        if (!existing.brand && p.brand) existing.brand = p.brand;
        if (!existing.sku && p.sku) existing.sku = p.sku;
      } else {
        seen.set(key, { ...p });
      }
    }
    return Array.from(seen.values());
  };

  const toggleAll = () => {
    if (selectedIds.size === mergedProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mergedProducts.map((_, i) => i)));
    }
  };

  const toggleOne = (idx: number) => {
    const next = new Set(selectedIds);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIds(next);
  };

  const removeProduct = (idx: number) => {
    setMergedProducts((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (id < idx) next.add(id);
        else if (id > idx) next.add(id - 1);
      }
      return next;
    });
  };

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return mergedProducts.map((p, i) => ({ ...p, _idx: i }));
    const term = searchTerm.toLowerCase();
    return mergedProducts
      .map((p, i) => ({ ...p, _idx: i }))
      .filter((p) => p.name.toLowerCase().includes(term) || (p.sku && p.sku.toLowerCase().includes(term)));
  }, [mergedProducts, searchTerm]);

  const handleConfirm = async () => {
    const selected = mergedProducts.filter((_, i) => selectedIds.has(i));
    if (selected.length === 0) return;
    setImporting(true);
    try {
      await onConfirmImport(selected, files);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const totalFromFiles = parsedDatasets.reduce((sum, ds) => sum + ds.products.length, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Importação Inteligente
          </DialogTitle>
        </DialogHeader>

        {/* Step: Parsing */}
        {step === "parsing" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">A carregar e analisar ficheiros...</p>
              <p className="text-xs text-muted-foreground mt-1">
                {files.map((f) => f.name).join(", ")}
              </p>
            </div>
            <Progress value={parseProgress} className="w-64" />
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step: Analyzing (multi-file merge) */}
        {step === "analyzing" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">A comparar e reconciliar dados...</p>
              <p className="text-xs text-muted-foreground mt-1">
                {parsedDatasets.length} ficheiros · {totalFromFiles} produtos encontrados
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                A IA está a cruzar referências, eliminar duplicados e preencher dados em falta.
              </p>
            </div>
          </div>
        )}

        {/* Step: Review */}
        {step === "review" && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {mergedProducts.length} produtos
              </Badge>
              {parsedDatasets.length > 1 && (
                <Badge variant="outline" className="text-xs">
                  Dados cruzados de {parsedDatasets.length} ficheiros
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {selectedIds.size} selecionados
              </Badge>
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 w-48 pl-7 text-xs"
                />
              </div>
            </div>

            <ScrollArea className="flex-1 max-h-[50vh] border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 w-8">
                      <Checkbox checked={selectedIds.size === mergedProducts.length} onCheckedChange={toggleAll} />
                    </th>
                    <th className="p-2 text-left font-medium">SKU</th>
                    <th className="p-2 text-left font-medium">Nome</th>
                    <th className="p-2 text-right font-medium">Custo</th>
                    <th className="p-2 text-right font-medium">Preço</th>
                    <th className="p-2 text-right font-medium">Stock</th>
                    <th className="p-2 text-left font-medium">Marca</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => (
                    <tr key={p._idx} className={`border-t hover:bg-muted/20 transition-colors ${selectedIds.has(p._idx) ? "" : "opacity-40"}`}>
                      <td className="p-2">
                        <Checkbox checked={selectedIds.has(p._idx)} onCheckedChange={() => toggleOne(p._idx)} />
                      </td>
                      <td className="p-2 font-mono text-muted-foreground">{p.sku || "—"}</td>
                      <td className="p-2 max-w-[200px] truncate font-medium">{p.name}</td>
                      <td className="p-2 text-right">{p.cost ? `€${p.cost.toFixed(2)}` : "—"}</td>
                      <td className="p-2 text-right">{p.price ? `€${p.price.toFixed(2)}` : "—"}</td>
                      <td className="p-2 text-right">{p.stock || "—"}</td>
                      <td className="p-2 text-muted-foreground">{p.brand || "—"}</td>
                      <td className="p-2">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeProduct(p._idx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-muted-foreground">
                        {searchTerm ? "Nenhum resultado para a pesquisa." : "Nenhum produto para importar."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}
          </>
        )}

        {step === "review" && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={importing}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={selectedIds.size === 0 || importing}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                `Importar ${selectedIds.size} produtos`
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
