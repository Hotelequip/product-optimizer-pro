import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProducts, useCreateProduct, useUpdateProduct, Product } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useCatalogs, useCreateCatalog, useDeleteCatalog, useRenameCatalog, useUpdateCatalog } from "@/hooks/useCatalogs";
import { useAllProductImages, useAddProductImage, useDeleteProductImage, ProductImage } from "@/hooks/useProductImages";
import { useCatalogFiles, useAddCatalogFile, useDeleteCatalogFile } from "@/hooks/useCatalogFiles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Upload, Sheet, FileUp, Loader2, FolderPlus, Folder, FolderOpen, Trash2, Search, Pencil, ImageIcon, FileText, Download, File } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SpreadsheetEditor } from "@/components/SpreadsheetEditor";
import { WooCommerceSync } from "@/components/WooCommerceSync";
import { ImportWizard, ParsedProduct } from "@/components/ImportWizard";
import { supabase } from "@/integrations/supabase/client";

export default function Catalog() {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: catalogs = [] } = useCatalogs();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const createCatalog = useCreateCatalog();
  const deleteCatalog = useDeleteCatalog();
  const renameCatalog = useRenameCatalog();
  const updateCatalog = useUpdateCatalog();
  const addCatalogFile = useAddCatalogFile();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>("all");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogSupplierUrl, setNewCatalogSupplierUrl] = useState("");
  const [showNewCatalogDialog, setShowNewCatalogDialog] = useState(false);
  const [editCatalogDialogOpen, setEditCatalogDialogOpen] = useState(false);
  const [editCatalogData, setEditCatalogData] = useState<{ id: string; name: string; supplier_url: string }>({ id: "", name: "", supplier_url: "" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editingCatalogName, setEditingCatalogName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardFiles, setWizardFiles] = useState<File[]>([]);
  const [fetchingImages, setFetchingImages] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [supplierBaseUrl, setSupplierBaseUrl] = useState("");

  // Filter products by selected catalog
  const filteredProducts = useMemo(() => {
    if (selectedCatalogId === "all") return products;
    if (selectedCatalogId === "uncategorized") return products.filter(p => !p.catalog_id);
    return products.filter(p => p.catalog_id === selectedCatalogId);
  }, [products, selectedCatalogId]);

  // Count products per catalog
  const catalogCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length, uncategorized: 0 };
    for (const p of products) {
      if (!p.catalog_id) { counts.uncategorized++; continue; }
      counts[p.catalog_id] = (counts[p.catalog_id] || 0) + 1;
    }
    return counts;
  }, [products]);

  const handleCreateCatalog = async () => {
    if (!newCatalogName.trim()) return;
    await createCatalog.mutateAsync({ name: newCatalogName.trim(), supplier_url: newCatalogSupplierUrl.trim() || undefined });
    setNewCatalogName("");
    setNewCatalogSupplierUrl("");
    setShowNewCatalogDialog(false);
  };

  const handleDeleteCatalog = async (id: string) => {
    await deleteCatalog.mutateAsync(id);
    if (selectedCatalogId === id) setSelectedCatalogId("all");
  };

  // Helper: normalize header string (lowercase, remove diacritics, trim)
  const normalizeHeader = (h: unknown) =>
    String(h || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  // Helper: parse number with European format support (1.234,56 → 1234.56)
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

  const parseCsvLine = (line: string, delimiter: string) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  };

  // Helper: find value from row using multiple possible keys
  const findVal = (row: Record<string, string>, keys: string[]): string => {
    const normalizedKeys = keys.map(normalizeHeader);
    for (const rk of Object.keys(row)) {
      const normalizedHeader = normalizeHeader(rk);
      if (normalizedKeys.some((k) => normalizedHeader.includes(k))) {
        return row[rk];
      }
    }
    return "";
  };

  const detectHeaderRowIndex = (rowsMatrix: unknown[][]) => {
    const headerHints = [
      "description", "descricao", "designacao", "name", "nome", "ref", "referencia", "sku", "codigo",
      "tarif", "cost", "custo", "price", "preco", "pvp", "stock", "quantidade", "qty",
    ];

    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < Math.min(40, rowsMatrix.length); i++) {
      const row = (rowsMatrix[i] || []) as unknown[];
      const cells = row.map((c) => normalizeHeader(c)).filter(Boolean);
      if (cells.length < 2) continue;

      const hintScore = cells.reduce((acc, cell) => {
        const matchesHint = headerHints.some((hint) => cell.includes(hint));
        return acc + (matchesHint ? 3 : /[a-zA-ZÀ-ÿ]/.test(cell) ? 1 : 0);
      }, 0);

      if (hintScore > bestScore) {
        bestScore = hintScore;
        bestIndex = i;
      }
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

  const buildSafeStoragePath = (file: File) => {
    const sanitizedName = file.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    return `${user!.id}/${Date.now()}-${sanitizedName || "arquivo"}`;
  };

  const insertProductsInBatches = async (items: Array<Record<string, unknown>>) => {
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase.from("products").insert(chunk as any).select("id");
      if (error) {
        throw new Error(`Falha no lote ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      }
      inserted += data?.length ?? chunk.length;
    }

    return inserted;
  };

  const attachImportedFile = async (file: File, catalogId: string | null, forcedType?: "excel" | "pdf" | "other") => {
    const storagePath = buildSafeStoragePath(file);
    const { error: uploadErr } = await supabase.storage
      .from("catalog-files")
      .upload(storagePath, file, { upsert: false, contentType: file.type || undefined });

    if (uploadErr) {
      throw new Error(`Falha ao associar ficheiro: ${uploadErr.message}`);
    }

    const { data: urlData } = supabase.storage.from("catalog-files").getPublicUrl(storagePath);
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const fileType = forcedType ?? (["xlsx", "xls", "csv"].includes(ext) ? "excel" : ext === "pdf" ? "pdf" : "other");

    await addCatalogFile.mutateAsync({
      catalog_id: catalogId,
      file_name: file.name,
      file_url: urlData.publicUrl,
      file_type: fileType,
      file_size: file.size,
    });
  };

  // Excel/CSV import — assigns to selected catalog
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (!user) {
      toast({ title: "Sessão expirada", description: "Inicie sessão novamente para importar.", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      let rows: Record<string, string>[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });

        rows = wb.SheetNames.flatMap((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
          const headerRowIdx = detectHeaderRowIndex(allRows as unknown[][]);
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", range: headerRowIdx });

          return jsonData
            .map((r) => {
              const out: Record<string, string> = {};
              Object.keys(r).forEach((k) => {
                out[String(k).trim()] = String(r[k] ?? "").trim();
              });
              return out;
            })
            .filter((r) => Object.values(r).some((v) => v.length > 0));
        });
      } else if (ext === "csv") {
        const text = await file.text();
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (lines.length < 2) throw new Error("CSV sem dados suficientes.");

        const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
        const headers = parseCsvLine(lines[0], delimiter);

        for (let i = 1; i < lines.length; i++) {
          const vals = parseCsvLine(lines[i], delimiter);
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = vals[idx] || "";
          });
          rows.push(row);
        }
      } else {
        throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv");
      }

      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

      const mapped = rows
        .map((row) => {
          const directName = findVal(row, ["description", "descricao", "name", "nome", "titulo", "title", "product name", "produto", "designacao"]);
          const fallbackName = Object.values(row).find((v) => {
            const value = String(v || "").trim();
            return value.length > 2 && /[a-zA-ZÀ-ÿ]/.test(value) && !/^\d+$/.test(value);
          }) || "";
          const name = (directName || fallbackName).trim();

          if (!name) return null;

          const stockRaw = parseNum(findVal(row, ["stock", "estoque", "qty", "quantidade", "std", "units"]));

          return {
            user_id: user.id,
            name,
            description: null,
            sku: findVal(row, ["ref", "sku", "referencia", "codigo", "code", "cod"]) || null,
            cost: parseNum(findVal(row, ["cost", "custo", "tarif", "preco custo", "net", "euro"])),
            price: parseNum(findVal(row, ["price", "preco", "pvp", "sell", "venda"])),
            stock: Number.isFinite(stockRaw) ? Math.max(0, Math.trunc(stockRaw)) : 0,
            brand: findVal(row, ["brand", "marca"]) || null,
            supplier_url: findVal(row, ["supplier_url", "url", "fornecedor_url"]) || null,
            status: "draft",
            catalog_id: catalogId,
          };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

      const deduped: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      for (const product of mapped) {
        const key = `${String(product.sku ?? "").toLowerCase()}|${String(product.name ?? "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(product);
      }

      if (deduped.length === 0) {
        throw new Error("Nenhuma linha válida encontrada para importar.");
      }

      const imported = await insertProductsInBatches(deduped);
      await attachImportedFile(file, catalogId, "excel");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog_files"] }),
      ]);

      toast({
        title: `${imported} produtos importados`,
        description: `Ficheiro ${file.name} associado com sucesso.`,
      });
    } catch (err: any) {
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  // PDF import
  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;

    if (!user) {
      toast({ title: "Sessão expirada", description: "Inicie sessão novamente para importar.", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
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

      if (!fullText.trim()) throw new Error("PDF vazio.");

      const { data, error } = await supabase.functions.invoke("extract-products", { body: { text: fullText } });
      if (error) throw error;

      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

      if (!data?.success || !Array.isArray(data.products) || data.products.length === 0) {
        throw new Error("Nenhum produto encontrado no PDF.");
      }

      const productsToInsert = data.products
        .map((p: any) => ({
          user_id: user.id,
          name: String(p?.name || "").trim(),
          description: p?.description || null,
          sku: p?.sku || null,
          cost: parseNum(p?.cost),
          price: parseNum(p?.price),
          stock: Math.max(0, Math.trunc(parseNum(p?.stock))),
          brand: p?.brand || null,
          status: "draft",
          catalog_id: catalogId,
        }))
        .filter((p: any) => p.name.length > 0);

      if (productsToInsert.length === 0) {
        throw new Error("Não foi possível mapear produtos válidos do PDF.");
      }

      const imported = await insertProductsInBatches(productsToInsert);
      await attachImportedFile(file, catalogId, "pdf");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog_files"] }),
      ]);

      toast({
        title: `${imported} produtos importados do PDF`,
        description: `Ficheiro ${file.name} associado com sucesso.`,
      });
    } catch (err: any) {
      toast({ title: "Erro ao processar PDF", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    const supported = droppedFiles.filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return ["xlsx", "xls", "csv", "pdf"].includes(ext || "");
    });
    if (supported.length === 0) {
      toast({ title: "Formato não suportado", description: "Use .xlsx, .xls, .csv ou .pdf", variant: "destructive" });
      return;
    }
    // Always open wizard for drag-and-drop (supports single + multi-file)
    setWizardFiles(supported);
    setWizardOpen(true);
  };

  // Fetch images for products missing image_url
  const fetchMissingImages = async (baseUrl?: string) => {
    if (!user || fetchingImages) return;
    setFetchingImages(true);
    setImageDialogOpen(false);
    try {
      const { data: noImageProducts } = await supabase
        .from("products")
        .select("id, name, sku, supplier_url")
        .eq("user_id", user.id)
        .is("image_url", null)
        .limit(30);

      if (!noImageProducts || noImageProducts.length === 0) {
        toast({ title: "Todos os produtos já têm imagem", description: "Nenhum produto sem imagem encontrado." });
        setFetchingImages(false);
        return;
      }

      toast({
        title: `A procurar imagens para ${noImageProducts.length} produto(s)...`,
        description: baseUrl ? `No site ${baseUrl}` : "Via pesquisa web. Isto pode demorar.",
      });

      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: {
          action: "fetch_images",
          products: noImageProducts,
          base_supplier_url: baseUrl || null,
        },
      });

      if (error || !data?.success) {
        console.warn("Image fetch failed:", error || data?.error);
        toast({ title: "Erro ao procurar imagens", description: data?.error || "Tente novamente.", variant: "destructive" });
        setFetchingImages(false);
        return;
      }

      const results = data.results || [];
      let foundCount = 0;

      for (const r of results) {
        if (r.success && r.image_url) {
          await supabase
            .from("products")
            .update({ image_url: r.image_url })
            .eq("id", r.product_id);
          foundCount++;
        }
      }

      if (foundCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["products"] });
        toast({
          title: `${foundCount} imagem(ns) encontrada(s)`,
          description: "Imagens de produtos atualizadas automaticamente.",
        });
      } else {
        toast({ title: "Nenhuma imagem encontrada", description: "Não foi possível encontrar imagens para os produtos." });
      }
    } catch (e) {
      console.warn("Background image fetch error:", e);
    } finally {
      setFetchingImages(false);
    }
  };

  const handleWizardConfirm = async (products: ParsedProduct[], files: File[]) => {
    if (!user) throw new Error("Sessão expirada.");

    const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

    // Fetch existing products for this user to match against
    const { data: existingProducts } = await supabase
      .from("products")
      .select("id, sku, name, catalog_id")
      .eq("user_id", user.id);

    const existing = existingProducts || [];

    // Build lookup maps for matching
    const bySku = new Map<string, { id: string; catalog_id: string | null }>();
    const byName = new Map<string, { id: string; catalog_id: string | null }>();
    for (const p of existing) {
      if (p.sku) bySku.set(p.sku.toLowerCase().trim(), { id: p.id, catalog_id: p.catalog_id });
      byName.set(p.name.toLowerCase().trim(), { id: p.id, catalog_id: p.catalog_id });
    }

    const toInsert: Array<Record<string, unknown>> = [];
    const toUpdate: Array<{ id: string; updates: Record<string, unknown> }> = [];

    for (const p of products) {
      // Try to match by SKU first, then by name
      const skuKey = p.sku?.toLowerCase().trim();
      const nameKey = p.name.toLowerCase().trim();
      const match = (skuKey ? bySku.get(skuKey) : undefined) || byName.get(nameKey);

      if (match) {
        // Update existing product — only update fields that have values
        const updates: Record<string, unknown> = {};
        if (p.description) updates.description = p.description;
        if (p.sku) updates.sku = p.sku;
        if (p.cost > 0) updates.cost = p.cost;
        if (p.price > 0) updates.price = p.price;
        if (p.stock > 0) updates.stock = p.stock;
        if (p.brand) updates.brand = p.brand;
        if (p.supplier_url) updates.supplier_url = p.supplier_url;
        if (catalogId && !match.catalog_id) updates.catalog_id = catalogId;

        if (Object.keys(updates).length > 0) {
          toUpdate.push({ id: match.id, updates });
        }
      } else {
        toInsert.push({
          user_id: user.id,
          name: p.name,
          description: p.description || null,
          sku: p.sku || null,
          cost: p.cost || 0,
          price: p.price || 0,
          stock: p.stock || 0,
          brand: p.brand || null,
          supplier_url: p.supplier_url || null,
          status: "draft",
          catalog_id: catalogId,
        });
      }
    }

    // Batch insert new products
    let inserted = 0;
    if (toInsert.length > 0) {
      inserted = await insertProductsInBatches(toInsert);
    }

    // Batch update existing products
    let updated = 0;
    const UPDATE_BATCH = 50;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      const chunk = toUpdate.slice(i, i + UPDATE_BATCH);
      await Promise.all(
        chunk.map(({ id, updates }) =>
          supabase.from("products").update(updates as any).eq("id", id)
        )
      );
      updated += chunk.length;
    }

    // Attach all files
    for (const file of files) {
      try {
        await attachImportedFile(file, catalogId);
      } catch (e) {
        console.warn(`Failed to attach ${file.name}:`, e);
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["catalog_files"] }),
    ]);

    const parts: string[] = [];
    if (inserted > 0) parts.push(`${inserted} novos`);
    if (updated > 0) parts.push(`${updated} atualizados`);

    toast({
      title: `${parts.join(" · ")} produtos`,
      description: `${files.length} ficheiro(s) associado(s).`,
    });


  };

  return (
    <div
      className="space-y-6 relative"
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-primary rounded-2xl p-12 text-center">
            <Upload className="h-12 w-12 mx-auto mb-4 text-primary animate-bounce" />
            <p className="text-lg font-semibold text-foreground">Solte o ficheiro aqui</p>
            <p className="text-sm text-muted-foreground mt-1">Excel, CSV ou PDF</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          {selectedCatalogId === "all"
            ? "Catálogo"
            : selectedCatalogId === "uncategorized"
            ? "Catálogo — Sem pasta"
            : `Catálogo ${catalogs.find(c => c.id === selectedCatalogId)?.name || ""}`}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={importing} onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".xlsx,.xls,.csv";
            input.multiple = true;
            input.onchange = (ev) => {
              const selected = Array.from((ev.target as HTMLInputElement).files || []);
              if (selected.length > 0) { setWizardFiles(selected); setWizardOpen(true); }
            };
            input.click();
          }}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Excel/CSV
          </Button>
          <Button variant="outline" disabled={importing} onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".pdf";
            input.multiple = true;
            input.onchange = (ev) => {
              const selected = Array.from((ev.target as HTMLInputElement).files || []);
              if (selected.length > 0) { setWizardFiles(selected); setWizardOpen(true); }
            };
            input.click();
          }}>
            <FileUp className="mr-2 h-4 w-4" />PDF
          </Button>
          <Button variant="outline" disabled={fetchingImages} onClick={() => setImageDialogOpen(true)}>
            {fetchingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
            Buscar Imagens
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingProduct(null); }}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Produto</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingProduct ? "Editar Produto" : "Novo Produto"}</DialogTitle>
              </DialogHeader>
              <ProductForm
                product={editingProduct}
                categories={categories}
                catalogs={catalogs}
                selectedCatalogId={selectedCatalogId}
                onSubmit={async (data) => {
                  if (editingProduct) {
                    await updateProduct.mutateAsync({ id: editingProduct.id, ...data });
                  } else {
                    await createProduct.mutateAsync(data);
                  }
                  setDialogOpen(false);
                  setEditingProduct(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Catalog/Folder selector - compact dropdown */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Folder className="h-4 w-4" />
              {selectedCatalogId === "all"
                ? "Todas as pastas"
                : selectedCatalogId === "uncategorized"
                ? "Sem pasta"
                : catalogs.find(c => c.id === selectedCatalogId)?.name || "Pasta"}
              <span className="text-xs opacity-70">
                ({selectedCatalogId === "all"
                  ? catalogCounts.all
                  : selectedCatalogId === "uncategorized"
                  ? catalogCounts.uncategorized || 0
                  : catalogCounts[selectedCatalogId] || 0})
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto" onCloseAutoFocus={() => setCatalogSearch("")}>
            <div className="px-2 py-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar pasta..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="h-7 text-xs pl-7"
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                />
              </div>
            </div>
            <DropdownMenuSeparator />
            {!catalogSearch && (
              <>
                <DropdownMenuItem onClick={() => setSelectedCatalogId("all")} className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Todas as pastas
                  <span className="ml-auto text-xs text-muted-foreground">{catalogCounts.all}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCatalogId("uncategorized")} className="gap-2">
                  <Folder className="h-4 w-4" />
                  Sem pasta
                  <span className="ml-auto text-xs text-muted-foreground">{catalogCounts.uncategorized || 0}</span>
                </DropdownMenuItem>
                {catalogs.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            {catalogs
              .filter(cat => !catalogSearch || cat.name.toLowerCase().includes(catalogSearch.toLowerCase()))
              .map(cat => (
              <DropdownMenuItem key={cat.id} className="gap-2 group" onClick={() => { if (editingCatalogId !== cat.id) setSelectedCatalogId(cat.id); }}>
                <Folder className="h-4 w-4 shrink-0" />
                {editingCatalogId === cat.id ? (
                  <Input
                    value={editingCatalogName}
                    onChange={e => setEditingCatalogName(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === "Enter" && editingCatalogName.trim()) {
                        renameCatalog.mutate({ id: cat.id, name: editingCatalogName.trim() });
                        setEditingCatalogId(null);
                      }
                      if (e.key === "Escape") setEditingCatalogId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => {
                      if (editingCatalogName.trim() && editingCatalogName !== cat.name) {
                        renameCatalog.mutate({ id: cat.id, name: editingCatalogName.trim() });
                      }
                      setEditingCatalogId(null);
                    }}
                    className="h-6 text-xs flex-1"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 truncate">{cat.name}</span>
                )}
                <span className="text-xs text-muted-foreground">{catalogCounts[cat.id] || 0}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); setEditingCatalogId(cat.id); setEditingCatalogName(cat.name); }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDeleteCatalog(cat.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))}
            {catalogSearch && catalogs.filter(cat => cat.name.toLowerCase().includes(catalogSearch.toLowerCase())).length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">Nenhuma pasta encontrada</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {showNewCatalogInput ? (
          <div className="flex items-center gap-1">
            <Input
              placeholder="Nome da pasta..."
              value={newCatalogName}
              onChange={e => setNewCatalogName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateCatalog(); if (e.key === "Escape") setShowNewCatalogInput(false); }}
              className="h-8 w-40 text-sm"
              autoFocus
            />
            <Button size="sm" onClick={handleCreateCatalog} disabled={!newCatalogName.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowNewCatalogInput(true)} className="gap-1.5 border-dashed">
            <FolderPlus className="h-3.5 w-3.5" />
            Nova Pasta
          </Button>
        )}
      </div>

      <Tabs defaultValue="spreadsheet" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spreadsheet" className="gap-2"><Sheet className="h-4 w-4" />Planilha</TabsTrigger>
          <TabsTrigger value="images" className="gap-2"><ImageIcon className="h-4 w-4" />Imagens</TabsTrigger>
          <TabsTrigger value="files" className="gap-2"><FileText className="h-4 w-4" />Ficheiros</TabsTrigger>
          <TabsTrigger value="sync">🔄 WooCommerce</TabsTrigger>
        </TabsList>

        <TabsContent value="spreadsheet">
          {/* Drop zone */}
          <div
            className={`mb-4 border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".xlsx,.xls,.csv,.pdf";
              input.multiple = true;
              input.onchange = (ev) => {
                const selected = Array.from((ev.target as HTMLInputElement).files || []);
                if (selected.length > 0) { setWizardFiles(selected); setWizardOpen(true); }
              };
              input.click();
            }}
          >
            <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? "text-primary animate-bounce" : "text-muted-foreground"}`} />
            <p className="text-sm font-medium text-foreground">
              {importing ? "Importando..." : "Arraste ficheiros para aqui"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Excel, CSV ou PDF · ou clique para procurar</p>
          </div>

          <Card>
            <CardContent className="pt-4">
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Carregando...</p>
              ) : filteredProducts.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {products.length === 0
                    ? "Nenhum produto encontrado. Importe um ficheiro acima."
                    : "Nenhum produto nesta pasta."}
                </p>
              ) : (
                <SpreadsheetEditor products={filteredProducts} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="images">
          <Card>
            <CardHeader>
              <p className="text-xs text-muted-foreground">
                🖼️ Visualize e gere imagens para os seus produtos. Clique em "Gerar" para criar imagens com IA.
              </p>
            </CardHeader>
            <CardContent>
              <ProductImageGallery products={filteredProducts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files">
          <CatalogFilesTab selectedCatalogId={selectedCatalogId} />
        </TabsContent>

        <TabsContent value="sync">
          <WooCommerceSync />
        </TabsContent>
      </Tabs>

      <ImportWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setWizardFiles([]); }}
        files={wizardFiles}
        onConfirmImport={handleWizardConfirm}
      />

      {/* Image fetch dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar Imagens de Produtos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Indique o URL base do fornecedor para procurar imagens dos produtos. O sistema vai mapear o site e tentar encontrar as imagens por SKU/nome.
            </p>
            <div className="space-y-2">
              <Label>URL do Fornecedor (opcional)</Label>
              <Input
                placeholder="https://plasgourmet.com"
                value={supplierBaseUrl}
                onChange={(e) => setSupplierBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Ex: https://plasgourmet.com — deixe vazio para pesquisa web genérica
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setImageDialogOpen(false)}>Cancelar</Button>
              <Button
                disabled={fetchingImages}
                onClick={() => fetchMissingImages(supplierBaseUrl.trim() || undefined)}
              >
                {fetchingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Iniciar Busca
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductForm({
  product,
  categories,
  catalogs,
  selectedCatalogId,
  onSubmit,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  catalogs: { id: string; name: string }[];
  selectedCatalogId: string;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "none");
  const [catalogId, setCatalogId] = useState(
    (product as any)?.catalog_id || (selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : "none")
  );
  const [cost, setCost] = useState(product?.cost?.toString() || "0");
  const [price, setPrice] = useState(product?.price?.toString() || "0");
  const [stock, setStock] = useState(product?.stock?.toString() || "0");
  const [status, setStatus] = useState(product?.status || "draft");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit({
      name,
      description: description || null,
      sku: sku || null,
      category_id: categoryId === "none" ? null : categoryId,
      catalog_id: catalogId === "none" ? null : catalogId,
      cost: parseFloat(cost),
      price: parseFloat(price),
      stock: parseInt(stock),
      status,
      image_url: product?.image_url || null,
    });
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>SKU</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Referência" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Custo (R$)</Label>
          <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Preço (R$)</Label>
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Estoque</Label>
          <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Pendente</SelectItem>
              <SelectItem value="active">Publicado</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem categoria</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Pasta</Label>
          <Select value={catalogId} onValueChange={setCatalogId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem pasta</SelectItem>
              {catalogs.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Salvando..." : product ? "Atualizar" : "Criar Produto"}
      </Button>
    </form>
  );
}

function ProductImageGallery({ products }: { products: Product[] }) {
  const updateProduct = useUpdateProduct();
  const { data: allImages = [] } = useAllProductImages();
  const addImage = useAddProductImage();
  const deleteImage = useDeleteProductImage();
  const { toast } = useToast();
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [lightboxProduct, setLightboxProduct] = useState<Product | null>(null);
  const [lightboxImageIdx, setLightboxImageIdx] = useState(0);

  // Group images by product_id
  const imagesByProduct = useMemo(() => {
    const map: Record<string, ProductImage[]> = {};
    for (const img of allImages) {
      if (!map[img.product_id]) map[img.product_id] = [];
      map[img.product_id].push(img);
    }
    return map;
  }, [allImages]);

  const getProductImages = (product: Product): { url: string; type: string; id?: string }[] => {
    const imgs: { url: string; type: string; id?: string }[] = [];
    // Primary image from products table
    if (product.image_url) imgs.push({ url: product.image_url, type: "original" });
    // Additional images from product_images table
    const extra = imagesByProduct[product.id] || [];
    for (const e of extra) {
      if (e.url !== product.image_url) imgs.push({ url: e.url, type: e.type, id: e.id });
    }
    return imgs;
  };

  const uploadAndSaveImage = async (base64Url: string, productId: string, type: "original" | "optimized" | "ai_generated") => {
    const base64Data = base64Url.split(",")[1];
    const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const fileName = `${productId}-${type}-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(fileName, byteArray, { contentType: "image/png", upsert: true });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
    await addImage.mutateAsync({ product_id: productId, url: urlData.publicUrl, type });
    return urlData.publicUrl;
  };

  const generateImage = async (product: Product) => {
    setProcessingIds(prev => new Set(prev).add(product.id));
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "generate_image", product: { name: product.name, description: product.description } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        const publicUrl = await uploadAndSaveImage(data.image_url, product.id, "original");
        if (!product.image_url) await updateProduct.mutateAsync({ id: product.id, image_url: publicUrl });
        toast({ title: `Imagem gerada para ${product.name}!` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setProcessingIds(prev => { const n = new Set(prev); n.delete(product.id); return n; });
  };

  const optimizeImage = async (product: Product) => {
    if (!product.image_url) return;
    setProcessingIds(prev => new Set(prev).add(`opt-${product.id}`));
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "optimize_image", product: { image_url: product.image_url, product_name: product.name } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        await uploadAndSaveImage(data.image_url, product.id, "optimized");
        toast({ title: `Imagem otimizada para ${product.name}!` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setProcessingIds(prev => { const n = new Set(prev); n.delete(`opt-${product.id}`); return n; });
  };

  const generateScene = async (product: Product) => {
    if (!product.image_url) return;
    setProcessingIds(prev => new Set(prev).add(`scene-${product.id}`));
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "generate_scene", product: { image_url: product.image_url, product_name: product.name, description: product.description } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        await uploadAndSaveImage(data.image_url, product.id, "ai_generated");
        toast({ title: `Cenário gerado para ${product.name}!` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setProcessingIds(prev => { const n = new Set(prev); n.delete(`scene-${product.id}`); return n; });
  };

  const generateAll = async () => {
    const withoutImage = products.filter(p => !p.image_url);
    if (withoutImage.length === 0) { toast({ title: "Todos os produtos já têm imagem!" }); return; }
    setBulkGenerating(true);
    let generated = 0;
    for (const p of withoutImage) {
      try { await generateImage(p); generated++; } catch {}
    }
    toast({ title: `${generated} imagens geradas!` });
    setBulkGenerating(false);
  };

  const withImage = products.filter(p => p.image_url);
  const withoutImage = products.filter(p => !p.image_url);

  // Lightbox images
  const lightboxImages = lightboxProduct ? getProductImages(lightboxProduct) : [];

  const typeLabels: Record<string, string> = { original: "Original", optimized: "Otimizada", ai_generated: "IA Cenário" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {withImage.length} com imagem · {withoutImage.length} sem imagem
        </div>
        {withoutImage.length > 0 && (
          <Button size="sm" onClick={generateAll} disabled={bulkGenerating}>
            {bulkGenerating ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-2 h-3 w-3" />}
            Gerar Todas ({withoutImage.length})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {products.map(product => {
          const imgs = getProductImages(product);
          const imgCount = imgs.length;
          return (
            <div key={product.id} className="group border rounded-lg overflow-hidden bg-card cursor-pointer" onClick={() => { setLightboxProduct(product); setLightboxImageIdx(0); }}>
              <div className="aspect-square bg-muted/30 flex items-center justify-center relative">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-[10px]">Sem imagem</span>
                  </div>
                )}
                {imgCount > 1 && (
                  <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {imgCount}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 flex-wrap p-2" onClick={e => e.stopPropagation()}>
                  {!product.image_url && (
                    <Button size="sm" variant="secondary" className="text-[10px] h-6 px-2"
                      onClick={() => generateImage(product)} disabled={processingIds.has(product.id)}>
                      {processingIds.has(product.id) ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-1 h-3 w-3" />}
                      Gerar
                    </Button>
                  )}
                  {product.image_url && (
                    <>
                      <Button size="sm" variant="secondary" className="text-[10px] h-6 px-2"
                        onClick={() => optimizeImage(product)} disabled={processingIds.has(`opt-${product.id}`)}>
                        {processingIds.has(`opt-${product.id}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : "✨ Otimizar"}
                      </Button>
                      <Button size="sm" variant="secondary" className="text-[10px] h-6 px-2"
                        onClick={() => generateScene(product)} disabled={processingIds.has(`scene-${product.id}`)}>
                        {processingIds.has(`scene-${product.id}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : "🏠 Cenário"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium truncate" title={product.name}>{product.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{product.sku || "Sem SKU"}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox Dialog */}
      <Dialog open={!!lightboxProduct} onOpenChange={() => setLightboxProduct(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {lightboxProduct?.name}
              {lightboxProduct?.sku && <span className="text-xs text-muted-foreground font-normal">({lightboxProduct.sku})</span>}
            </DialogTitle>
          </DialogHeader>
          {lightboxProduct && lightboxImages.length > 0 && (
            <div className="space-y-4">
              {/* Main image */}
              <div className="relative bg-muted/20 rounded-lg flex items-center justify-center min-h-[300px] max-h-[50vh]">
                <img
                  src={lightboxImages[lightboxImageIdx]?.url}
                  alt={lightboxProduct.name}
                  className="max-w-full max-h-[50vh] object-contain rounded-lg"
                />
                <Badge className="absolute top-2 left-2 text-[10px]">
                  {typeLabels[lightboxImages[lightboxImageIdx]?.type] || "Original"}
                </Badge>
                {lightboxImages[lightboxImageIdx]?.id && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="absolute top-2 right-2 h-7 text-xs"
                    onClick={async () => {
                      const img = lightboxImages[lightboxImageIdx];
                      if (img.id) {
                        await deleteImage.mutateAsync(img.id);
                        toast({ title: "Imagem eliminada" });
                        if (lightboxImageIdx > 0) setLightboxImageIdx(lightboxImageIdx - 1);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Eliminar
                  </Button>
                )}
              </div>

              {/* Thumbnail strip */}
              {lightboxImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {lightboxImages.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setLightboxImageIdx(idx)}
                      className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                        idx === lightboxImageIdx ? "border-primary" : "border-transparent hover:border-muted-foreground/50"
                      }`}
                    >
                      <img src={img.url} alt="" className="w-full h-full object-contain bg-muted/30" />
                    </button>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => optimizeImage(lightboxProduct)}
                  disabled={!lightboxProduct.image_url || processingIds.has(`opt-${lightboxProduct.id}`)}>
                  {processingIds.has(`opt-${lightboxProduct.id}`) ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  ✨ Otimizar Qualidade
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateScene(lightboxProduct)}
                  disabled={!lightboxProduct.image_url || processingIds.has(`scene-${lightboxProduct.id}`)}>
                  {processingIds.has(`scene-${lightboxProduct.id}`) ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  🏠 Gerar Cenário Real
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateImage(lightboxProduct)}
                  disabled={processingIds.has(lightboxProduct.id)}>
                  {processingIds.has(lightboxProduct.id) ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  <ImageIcon className="mr-2 h-3 w-3" />Gerar Nova
                </Button>
                {lightboxImages[lightboxImageIdx] && lightboxImages[lightboxImageIdx].url !== lightboxProduct.image_url && (
                  <Button size="sm" onClick={async () => {
                    await updateProduct.mutateAsync({ id: lightboxProduct.id, image_url: lightboxImages[lightboxImageIdx].url });
                    toast({ title: "Imagem principal atualizada!" });
                  }}>
                    Definir como Principal
                  </Button>
                )}
              </div>
            </div>
          )}
          {lightboxProduct && lightboxImages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground space-y-3">
              <ImageIcon className="h-12 w-12 mx-auto" />
              <p className="text-sm">Nenhuma imagem para este produto</p>
              <Button size="sm" onClick={() => generateImage(lightboxProduct)} disabled={processingIds.has(lightboxProduct.id)}>
                {processingIds.has(lightboxProduct.id) ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-2 h-3 w-3" />}
                Gerar com IA
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatalogFilesTab({ selectedCatalogId }: { selectedCatalogId: string }) {
  const { data: files = [], isLoading } = useCatalogFiles(selectedCatalogId);
  const addFile = useAddCatalogFile();
  const deleteFile = useDeleteCatalogFile();
  const { user } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

  const uploadFile = async (file: globalThis.File) => {
    if (!user) {
      toast({ title: "Sessão expirada", description: "Inicie sessão novamente para carregar ficheiros.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const sanitizedName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const storagePath = `${user.id}/${Date.now()}-${sanitizedName || "arquivo"}`;
      const { error: uploadError } = await supabase.storage
        .from("catalog-files")
        .upload(storagePath, file, { upsert: false, contentType: file.type || undefined });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("catalog-files").getPublicUrl(storagePath);
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const fileType = ["xlsx", "xls", "csv"].includes(ext) ? "excel" : ext === "pdf" ? "pdf" : "other";

      await addFile.mutateAsync({
        catalog_id: catalogId,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        file_size: file.size,
      });

      toast({ title: `Ficheiro "${file.name}" carregado!` });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(f => uploadFile(f));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type === "pdf") return <FileUp className="h-5 w-5 text-destructive" />;
    if (type === "excel") return <Sheet className="h-5 w-5 text-primary" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.accept = ".xlsx,.xls,.csv,.pdf,.doc,.docx,.txt,.zip";
          input.onchange = (ev) => {
            const selectedFiles = Array.from((ev.target as HTMLInputElement).files || []);
            selectedFiles.forEach(f => uploadFile(f));
          };
          input.click();
        }}
      >
        <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? "text-primary animate-bounce" : "text-muted-foreground"}`} />
        <p className="text-sm font-medium">
          {uploading ? "Carregando..." : "Arraste ficheiros para aqui"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Excel, CSV, PDF ou outros · ou clique para procurar</p>
      </div>

      {/* File list */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : files.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhum ficheiro associado a esta pasta.</p>
          ) : (
            <div className="space-y-2">
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors group">
                  {getFileIcon(f.file_type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.file_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatSize(f.file_size)} · {new Date(f.created_at).toLocaleDateString("pt-PT")}
                    </p>
                  </div>
                  <a href={f.file_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => { deleteFile.mutate(f.id); toast({ title: "Ficheiro eliminado" }); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
