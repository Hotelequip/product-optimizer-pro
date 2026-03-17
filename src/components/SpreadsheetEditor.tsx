import { useState, useMemo } from "react";
import { Product, useUpdateProduct, useDeleteProduct } from "@/hooks/useProducts";
import { useAllVariations, ProductVariation } from "@/hooks/useProductVariations";
import { useCategories } from "@/hooks/useCategories";
import { useCatalogs } from "@/hooks/useCatalogs";
import { useWooStores } from "@/hooks/useWooStores";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Wand2, Image as ImageIcon, Loader2, Globe, Zap, Pencil, Settings, Check, ExternalLink, Filter, X, FolderInput, Trash2, FileSpreadsheet, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface EditableCell {
  productId: string;
  field: string;
}

function slugify(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function calcSeoScore(p: Product): number {
  let score = 0;
  if (p.optimized_title || p.seo_title) score += 25;
  if (p.meta_description || p.short_description) score += 25;
  if (p.slug) score += 15;
  if (p.description && p.description.length > 50) score += 15;
  if (p.tags && p.tags.length > 0) score += 10;
  if (p.image_url) score += 10;
  return score;
}

const FILE_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "nome", "title", "titulo", "designacao", "product", "produto", "description", "descricao"],
  sku: ["sku", "ref", "referencia", "codigo", "code", "cod", "product code", "item number"],
  categories: ["categories", "category", "categorias", "categoria", "product categories", "categoria do produto"],
  brand: ["brand", "marca", "fabricante", "manufacturer", "vendor"],
};

const normalizeHeader = (h: unknown) =>
  String(h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

const findFileField = (row: Record<string, string>, field: keyof typeof FILE_FIELD_ALIASES): string => {
  const aliases = FILE_FIELD_ALIASES[field].map(normalizeHeader);
  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);
    if (aliases.some((alias) => normalized.includes(alias))) return String(row[key] || "").trim();
  }
  return "";
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

const detectHeaderRowIndex = (rowsMatrix: unknown[][]) => {
  const headerHints = ["sku", "ref", "name", "nome", "title", "brand", "marca", "categories", "categoria"];
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(40, rowsMatrix.length); i++) {
    const row = (rowsMatrix[i] || []) as unknown[];
    const cells = row.map((c) => normalizeHeader(c)).filter(Boolean);
    if (cells.length < 2) continue;

    const score = cells.reduce((acc, cell) => {
      const hasHint = headerHints.some((hint) => cell.includes(hint));
      return acc + (hasHint ? 3 : /[a-zA-ZÀ-ÿ]/.test(cell) ? 1 : 0);
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex > 0 ? bestIndex : 0;
};

const normalizeLookupKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const extractPrimaryCategoryName = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const firstGroup = raw
    .split(/[;,|]/)
    .map((part) => part.trim())
    .find(Boolean) || "";

  const breadcrumbParts = firstGroup
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  return breadcrumbParts.length > 0 ? breadcrumbParts[breadcrumbParts.length - 1] : firstGroup;
};

type FileDerivedHints = {
  category_name: string | null;
  brand: string | null;
};

const mergeHint = (current: FileDerivedHints | undefined, incoming: FileDerivedHints): FileDerivedHints => ({
  category_name: current?.category_name || incoming.category_name || null,
  brand: current?.brand || incoming.brand || null,
});

export function SpreadsheetEditor({ products }: { products: Product[] }) {
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const { data: catalogs = [] } = useCatalogs();
  const { data: categories = [] } = useCategories();
  const { data: allVariations = [] } = useAllVariations();
  const { data: wooStores = [] } = useWooStores();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<EditableCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const [scrapingId, setScrapingId] = useState<string | null>(null);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, label: "" });
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [syncingWoo, setSyncingWoo] = useState(false);

  const setFilter = (col: string, value: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value) next[col] = value; else delete next[col];
      return next;
    });
  };
  const clearFilters = () => setColumnFilters({});
  const hasFilters = Object.keys(columnFilters).length > 0;

  const filteredProducts = useMemo(() => {
    if (!hasFilters) return products;
    return products.filter(p => {
      for (const [col, val] of Object.entries(columnFilters)) {
        const v = val.toLowerCase();
        if (col === "sku" && !(p.sku || "").toLowerCase().includes(v)) return false;
        if (col === "name" && !p.name.toLowerCase().includes(v)) return false;
        if (col === "optimized_title" && !(p.optimized_title || "").toLowerCase().includes(v)) return false;
        if (col === "category") {
          const catName = categories.find(c => c.id === p.category_id)?.name || "";
          if (!catName.toLowerCase().includes(v)) return false;
        }
        if (col === "short_description" && !(p.short_description || "").toLowerCase().includes(v)) return false;
        if (col === "slug" && !(p.slug || "").toLowerCase().includes(v)) return false;
        if (col === "status" && v !== "all" && p.status !== v) return false;
        if (col === "enrichment_phase" && v !== "all") {
          const phase = p.enrichment_phase || 0;
          if (String(phase) !== v) return false;
        }
      }
      return true;
    });
  }, [products, columnFilters, categories]);

  const buildCatalogFileHints = async (selected: Product[]) => {
    const hintsByLookupKey = new Map<string, FileDerivedHints>();

    const targetSkuKeys = new Set(
      selected
        .map((p) => normalizeLookupKey(p.sku))
        .filter(Boolean),
    );

    const targetNameKeys = new Set(
      selected
        .map((p) => normalizeLookupKey(p.name))
        .filter(Boolean),
    );

    const catalogIds = Array.from(
      new Set(
        selected
          .map((p) => p.catalog_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if ((targetSkuKeys.size === 0 && targetNameKeys.size === 0) || catalogIds.length === 0) {
      return hintsByLookupKey;
    }

    const { data: linkedFiles, error: filesError } = await supabase
      .from("catalog_files")
      .select("file_name, file_url, file_type, catalog_id, created_at")
      .in("catalog_id", catalogIds)
      .order("created_at", { ascending: false });

    if (filesError || !linkedFiles || linkedFiles.length === 0) {
      return hintsByLookupKey;
    }

    const processRow = (row: Record<string, string>) => {
      const sku = findFileField(row, "sku");
      const name = findFileField(row, "name");
      const skuKey = normalizeLookupKey(sku);
      const nameKey = normalizeLookupKey(name);
      const shouldUseSku = Boolean(skuKey) && targetSkuKeys.has(skuKey);
      const shouldUseName = Boolean(nameKey) && targetNameKeys.has(nameKey);

      if (!shouldUseSku && !shouldUseName) return;

      const categoryName = extractPrimaryCategoryName(findFileField(row, "categories")) || null;
      const brandName = findFileField(row, "brand") || null;

      if (!categoryName && !brandName) return;

      const incomingHint: FileDerivedHints = { category_name: categoryName, brand: brandName };

      if (shouldUseSku && skuKey) {
        hintsByLookupKey.set(skuKey, mergeHint(hintsByLookupKey.get(skuKey), incomingHint));
      }

      if (shouldUseName && nameKey) {
        hintsByLookupKey.set(nameKey, mergeHint(hintsByLookupKey.get(nameKey), incomingHint));
      }
    };

    let XLSX: any = null;

    const typedLinkedFiles = linkedFiles as unknown as Array<{ file_name: string; file_url: string; file_type: string }>;

    for (const file of typedLinkedFiles) {
      const ext = file.file_name.split(".").pop()?.toLowerCase() || "";
      const isSpreadsheet = file.file_type === "excel" || ext === "csv" || ext === "xlsx" || ext === "xls";
      if (!isSpreadsheet) continue;

      try {
        const response = await fetch(file.file_url);
        if (!response.ok) continue;

        if (ext === "csv") {
          const text = await response.text();
          const lines = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

          if (lines.length < 2) continue;

          const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
          const headers = parseCsvLine(lines[0], delimiter);

          for (let i = 1; i < lines.length; i++) {
            const values = parseCsvLine(lines[i], delimiter);
            const row: Record<string, string> = {};
            headers.forEach((header, idx) => {
              row[header] = values[idx] || "";
            });
            processRow(row);
          }
          continue;
        }

        XLSX = XLSX || (await import("xlsx"));
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as unknown[][];
          const headerRowIdx = detectHeaderRowIndex(allRows);
          const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "", range: headerRowIdx }) as Array<Record<string, unknown>>;

          for (const rawRow of jsonRows) {
            const row: Record<string, string> = {};
            Object.keys(rawRow).forEach((key) => {
              row[String(key).trim()] = String(rawRow[key] ?? "").trim();
            });
            processRow(row);
          }
        }
      } catch {
        // Ignore file-level parsing errors and continue with remaining files.
      }
    }

    return hintsByLookupKey;
  };

  const startEdit = (productId: string, field: string, currentValue: any) => {
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { productId, field } = editingCell;
    let value: any = editValue;
    if (field === "cost" || field === "price") value = parseFloat(editValue) || 0;
    if (field === "stock" || field === "seo_score" || field === "enrichment_phase") value = parseInt(editValue) || 0;
    try {
      await updateProduct.mutateAsync({ id: productId, [field]: value });
    } catch {}
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const isEditing = (productId: string, field: string) =>
    editingCell?.productId === productId && editingCell?.field === field;

  // AI Enrich
  const enrichProduct = async (product: Product) => {
    setEnrichingId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "enrich", product: { name: product.name, description: product.description, cost: product.cost, price: product.price, sku: product.sku, brand: product.brand } },
      });
      if (error) throw error;
      if (data.success && data.enriched) {
        const slug = slugify(data.enriched.slug || data.enriched.seo_title || data.enriched.optimized_title || product.name);
        await updateProduct.mutateAsync({
          id: product.id,
          description: data.enriched.description || product.description,
          optimized_title: data.enriched.optimized_title || data.enriched.seo_title || null,
          meta_description: data.enriched.meta_description || null,
          short_description: data.enriched.short_description || null,
          seo_title: data.enriched.seo_title || null,
          tags: data.enriched.tags || null,
          slug,
          product_type: data.enriched.product_type || product.product_type || "simple",
          enrichment_phase: Math.min((product.enrichment_phase || 0) + 1, 3),
          last_enriched_at: new Date().toISOString(),
        });
        toast({ title: "Produto enriquecido com IA!" });
      } else {
        toast({ title: "Erro ao enriquecer", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.includes("402") || msg.includes("créditos") || msg.includes("insuficientes")) {
        toast({ title: "Créditos insuficientes", description: "Adiciona créditos em Settings → Workspace → Usage para usar a IA.", variant: "destructive" });
      } else {
        toast({ title: "Erro", description: msg, variant: "destructive" });
      }
    }
    setEnrichingId(null);
  };

  // Generate Image
  const generateImage = async (product: Product) => {
    setGeneratingImageId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "generate_image", product: { name: product.name, description: product.description } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        const base64Data = data.image_url.split(",")[1];
        const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const fileName = `${product.id}-${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(fileName, byteArray, { contentType: "image/png", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
        await updateProduct.mutateAsync({ id: product.id, image_url: urlData.publicUrl });
        toast({ title: "Imagem gerada com IA!" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setGeneratingImageId(null);
  };

  // Web Scrape
  const scrapeProduct = async (product: Product) => {
    setScrapingId(product.id);
    try {
      const hasSupplier = product.supplier_url && product.supplier_url.trim().length > 0;
      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: hasSupplier
          ? { action: "scrape_supplier", supplier_url: product.supplier_url, sku: product.sku, product_name: product.name }
          : { action: "search_enrich", product_name: product.name, sku: product.sku },
      });
      if (error) throw error;
      if (data.success && data.enriched) {
        const updates: any = { id: product.id, last_enriched_at: new Date().toISOString() };
        if (data.enriched.description) updates.description = data.enriched.description;
        if (data.enriched.brand) updates.brand = data.enriched.brand;
        if (data.enriched.seo_title) { updates.optimized_title = data.enriched.seo_title; updates.slug = slugify(data.enriched.seo_title); }
        if (data.enriched.meta_description) updates.meta_description = data.enriched.meta_description;
        if (data.enriched.short_description) updates.short_description = data.enriched.short_description;
        if (data.enriched.specifications) updates.specifications = data.enriched.specifications;
        if (data.enriched.tags) updates.tags = data.enriched.tags;
        updates.enrichment_phase = Math.min((product.enrichment_phase || 0) + 1, 3);
        await updateProduct.mutateAsync(updates);
        toast({ title: hasSupplier ? "Dados do fornecedor extraídos!" : "Dados encontrados na web!" });
      } else {
        toast({ title: data.message || "Nenhum dado encontrado", variant: "destructive" });
      }
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.includes("402") || msg.includes("créditos") || msg.includes("insuficientes")) {
        toast({ title: "Créditos insuficientes", description: "Adiciona créditos em Settings → Workspace → Usage.", variant: "destructive" });
      } else {
        toast({ title: "Erro no web scraping", description: msg, variant: "destructive" });
      }
    }
    setScrapingId(null);
  };

  // Bulk enrich
  const bulkEnrich = async () => {
    const selected = products.filter(p => selectedProducts.has(p.id));
    if (selected.length === 0) { toast({ title: "Selecione produtos", variant: "destructive" }); return; }
    setBulkEnriching(true);
    toast({ title: `Enriquecendo ${selected.length} produtos...` });
    try {
      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: { action: "bulk_enrich", products: selected.map(p => ({ id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url })) },
      });
      if (error) throw error;
      if (data.success && data.results) {
        let enriched = 0;
        for (const result of data.results) {
          if (result.success && result.enriched) {
            const updates: any = { id: result.product_id, last_enriched_at: new Date().toISOString(), enrichment_phase: 1 };
            if (result.enriched.description) updates.description = result.enriched.description;
            if (result.enriched.brand) updates.brand = result.enriched.brand;
            if (result.enriched.seo_title) { updates.optimized_title = result.enriched.seo_title; updates.slug = slugify(result.enriched.seo_title); }
            if (result.enriched.meta_description) updates.meta_description = result.enriched.meta_description;
            if (result.enriched.specifications) updates.specifications = result.enriched.specifications;
            if (result.enriched.tags) updates.tags = result.enriched.tags;
            try { await updateProduct.mutateAsync(updates); enriched++; } catch {}
          }
        }
        toast({ title: `${enriched} de ${selected.length} produtos enriquecidos!` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setBulkEnriching(false);
    setSelectedProducts(new Set());
  };

  const toggleAll = () => {
    if (selectedProducts.size === products.length) setSelectedProducts(new Set());
    else setSelectedProducts(new Set(products.map(p => p.id)));
  };
  const toggleProduct = (id: string) => {
    const next = new Set(selectedProducts);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedProducts(next);
  };

  // WooCommerce Excel Export
  const exportWooCommerceExcel = async () => {
    const XLSX = await import("xlsx");
    const productsToExport = selectedProducts.size > 0
      ? products.filter(p => selectedProducts.has(p.id))
      : products;

    const stripHtml = (html: string | null) => {
      if (!html) return "";
      return html.replace(/<[^>]*>/g, "").trim();
    };

    // Build rows: parent products + their variations
    const wooRows: any[] = [];

    for (const p of productsToExport) {
      const catName = categories.find(c => c.id === p.category_id)?.name || "";
      const variations = allVariations.filter(v => v.parent_product_id === p.id);
      const isVariable = p.product_type === "variable" || variations.length > 0;

      // Collect unique attribute names from variations
      const attrNames: string[] = [];
      if (isVariable && variations.length > 0) {
        for (const v of variations) {
          for (const attr of (v.attributes || [])) {
            if (!attrNames.includes(attr.name)) attrNames.push(attr.name);
          }
        }
      }

      // Build attribute columns for parent (aggregated values)
      const attrCols: Record<string, string> = {};
      attrNames.forEach((name, i) => {
        const num = i + 1;
        const allValues = variations
          .map(v => (v.attributes || []).find((a: any) => a.name === name)?.value)
          .filter(Boolean);
        const uniqueValues = [...new Set(allValues)];
        attrCols[`Attribute ${num} name`] = name;
        attrCols[`Attribute ${num} value(s)`] = uniqueValues.join(" | ");
        attrCols[`Attribute ${num} visible`] = "1";
        attrCols[`Attribute ${num} global`] = "1";
      });

      // Parent product row
      wooRows.push({
        "Type": isVariable ? "variable" : "simple",
        "SKU": p.sku || "",
        "Name": p.optimized_title || p.name,
        "Published": p.status === "active" ? 1 : 0,
        "Is featured?": 0,
        "Visibility in catalog": "visible",
        "Short description": p.short_description || "",
        "Description": p.description || "",
        "Tax status": "taxable",
        "In stock?": p.stock > 0 ? 1 : 0,
        "Stock": p.stock,
        "Regular price": p.price || "",
        "Sale price": "",
        "Categories": catName,
        "Tags": (p.tags || []).join(", "),
        "Images": p.image_url || "",
        "Product Image Gallery": "",
        "Parent": "",
        "Marca Do Produto": p.brand || "",
        "Modelo Do Produto": "",
        "EAN do produto": (p as any).ean || "",
        "Up-Sells": "",
        "Cross-Sells": "",
        "Status": p.status === "active" ? "publish" : "draft",
        "Images Alt Text": stripHtml(p.optimized_title || p.name),
        ...attrCols,
        "meta:rank_math_title": p.seo_title || p.optimized_title || "",
        "meta:rank_math_description": p.meta_description || "",
        "meta:rank_math_focus_keyword": stripHtml(p.optimized_title || p.name),
        "Slug": p.slug || "",
      });

      // Variation rows
      if (isVariable && variations.length > 0) {
        for (const v of variations) {
          const varAttrCols: Record<string, string> = {};
          attrNames.forEach((name, i) => {
            const num = i + 1;
            const val = (v.attributes || []).find((a: any) => a.name === name)?.value || "";
            varAttrCols[`Attribute ${num} name`] = name;
            varAttrCols[`Attribute ${num} value(s)`] = val;
            varAttrCols[`Attribute ${num} visible`] = "";
            varAttrCols[`Attribute ${num} global`] = "1";
          });

          wooRows.push({
            "Type": "variation",
            "SKU": v.sku || "",
            "Name": v.name || "",
            "Published": 1,
            "Is featured?": "",
            "Visibility in catalog": "",
            "Short description": "",
            "Description": "",
            "Tax status": "taxable",
            "In stock?": v.stock > 0 ? 1 : 0,
            "Stock": v.stock,
            "Regular price": v.regular_price || v.price || "",
            "Sale price": v.sale_price || "",
            "Categories": "",
            "Tags": "",
            "Images": v.image_url || "",
            "Product Image Gallery": "",
            "Parent": `id:${p.sku || p.id}`,
            "Marca Do Produto": "",
            "Modelo Do Produto": "",
            "EAN do produto": v.ean || "",
            "Up-Sells": "",
            "Cross-Sells": "",
            "Status": v.status === "draft" ? "draft" : "publish",
            "Images Alt Text": "",
            ...varAttrCols,
            "meta:rank_math_title": "",
            "meta:rank_math_description": "",
            "meta:rank_math_focus_keyword": "",
            "Slug": "",
          });
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(wooRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");

    // Auto-size columns
    if (wooRows.length > 0) {
      const colWidths = Object.keys(wooRows[0]).map(key => ({
        wch: Math.max(key.length, ...wooRows.map(r => String(r[key] || "").substring(0, 50).length)) + 2,
      }));
      ws["!cols"] = colWidths;
    }

    XLSX.writeFile(wb, `woocommerce-import-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: `${wooRows.length} linhas exportadas para Excel WooCommerce (${productsToExport.length} produtos + variações)!` });
  };

  const renderCell = (product: Product, field: keyof Product, maxW?: string) => {
    if (isEditing(product.id, field)) {
      return (
        <Input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown} onBlur={saveEdit} className="h-7 text-xs px-2 w-full" />
      );
    }
    const value = product[field];
    return (
      <div className={`cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-xs truncate ${maxW || ""}`}
        onDoubleClick={() => startEdit(product.id, field, value)} title={String(value ?? "")}>
        {String(value ?? "") || <span className="text-muted-foreground">—</span>}
      </div>
    );
  };

  const getCategoryName = (catId: string | null) => {
    if (!catId) return "—";
    return categories.find(c => c.id === catId)?.name || "—";
  };

  const getStatusBadge = (product: Product) => {
    const isPublished = !!product.woo_synced_at;
    const labels: Record<string, string> = { active: isPublished ? "Publicado" : "Aprovado", inactive: "Inativo", draft: "Pendente" };
    const colors: Record<string, string> = {
      active: isPublished
        ? "bg-green-500/20 text-green-400 border-green-500/30"
        : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      inactive: "bg-muted text-muted-foreground",
      draft: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    };
    return (
      <div className="flex flex-wrap items-center gap-1" onDoubleClick={() => startEdit(product.id, "status", product.status)}>
        <Badge className={`text-[10px] px-1.5 py-0 border ${colors[product.status]} cursor-pointer`}>
          {labels[product.status]}
        </Badge>
        {product.supplier_url && <Badge variant="outline" className="text-[9px] px-1 py-0 border-sky-500/40 text-sky-400">Web</Badge>}
        {product.last_enriched_at && <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-500/40 text-violet-400">IA</Badge>}
        {product.tags && product.tags.length > 0 && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/40 text-orange-400">⚠{product.tags.length}</Badge>
        )}
      </div>
    );
  };

  const getPhaseButtons = (product: Product) => {
    const phase = product.enrichment_phase || 0;
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3].map(n => (
          <span key={n} className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-medium border
            ${phase >= n ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border"}`}>
            {n}
          </span>
        ))}
      </div>
    );
  };

  const getSeoScore = (product: Product) => {
    const score = product.seo_score || calcSeoScore(product);
    const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
    return <span className={`text-xs font-bold ${color}`}>{score}</span>;
  };

  return (
    <div className="space-y-3">
      {/* Export button - always visible */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={exportWooCommerceExcel} className="gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Exportar Excel WooCommerce
          {selectedProducts.size > 0 && ` (${selectedProducts.size})`}
        </Button>
      </div>
      {selectedProducts.size > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg border flex-wrap">
            <span className="text-sm font-medium">{selectedProducts.size} selecionados</span>
            <Button size="sm" onClick={async () => {
              const selected = products.filter(p => selectedProducts.has(p.id));
              if (selected.length === 0) return;
              setBulkEnriching(true);
              setBulkProgress({ current: 0, total: selected.length, label: "Web Scrape" });
              const { data, error } = await supabase.functions.invoke("web-scrape-product", {
                body: { action: "bulk_enrich", products: selected.map(p => ({ id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url })) },
              });
              if (!error && data?.success && data?.results) {
                let enriched = 0;
                for (const result of data.results) {
                  if (result.success && result.enriched) {
                    const updates: any = { id: result.product_id, last_enriched_at: new Date().toISOString(), enrichment_phase: 1 };
                    if (result.enriched.description) updates.description = result.enriched.description;
                    if (result.enriched.brand) updates.brand = result.enriched.brand;
                    if (result.enriched.seo_title) { updates.optimized_title = result.enriched.seo_title; updates.slug = slugify(result.enriched.seo_title); }
                    if (result.enriched.meta_description) updates.meta_description = result.enriched.meta_description;
                    if (result.enriched.specifications) updates.specifications = result.enriched.specifications;
                    if (result.enriched.tags) updates.tags = result.enriched.tags;
                    try { await updateProduct.mutateAsync(updates); enriched++; } catch {}
                  }
                  setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
                }
                toast({ title: `${enriched} de ${selected.length} produtos enriquecidos!` });
              } else {
                toast({ title: "Erro no web scrape", variant: "destructive" });
              }
              setBulkEnriching(false);
              setBulkProgress({ current: 0, total: 0, label: "" });
              setSelectedProducts(new Set());
            }} disabled={bulkEnriching}>
              {bulkEnriching && bulkProgress.label === "Web Scrape" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Globe className="mr-2 h-3 w-3" />}
              Web Scrape
            </Button>
            <Button size="sm" variant="secondary" onClick={async () => {
              const selected = products.filter(p => selectedProducts.has(p.id));
              if (selected.length === 0) return;
              setBulkEnriching(true);
              setBulkProgress({ current: 0, total: selected.length, label: "IA Enriquecer" });
              let enriched = 0;
              for (const p of selected) {
                try { await enrichProduct(p); enriched++; } catch {}
                setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
              }
              toast({ title: `${enriched} produtos enriquecidos com IA!` });
              setBulkEnriching(false);
              setBulkProgress({ current: 0, total: 0, label: "" });
              setSelectedProducts(new Set());
            }} disabled={bulkEnriching}>
              {bulkEnriching && bulkProgress.label === "IA Enriquecer" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Wand2 className="mr-2 h-3 w-3" />}
              IA Enriquecer
            </Button>
            <Button size="sm" variant="secondary" onClick={async () => {
              const selected = products.filter(p => selectedProducts.has(p.id));
              if (selected.length === 0) return;
              setBulkEnriching(true);
              setBulkProgress({ current: 0, total: selected.length, label: "Gerar Imagens" });
              let generated = 0;
              for (const p of selected) {
                try { await generateImage(p); generated++; } catch {}
                setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
              }
              toast({ title: `${generated} imagens geradas!` });
              setBulkEnriching(false);
              setBulkProgress({ current: 0, total: 0, label: "" });
              setSelectedProducts(new Set());
            }} disabled={bulkEnriching}>
              {bulkEnriching && bulkProgress.label === "Gerar Imagens" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <ImageIcon className="mr-2 h-3 w-3" />}
              Gerar Imagens
            </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              const selected = products.filter(p => selectedProducts.has(p.id));
              setBulkProgress({ current: 0, total: selected.length, label: "Aprovar" });
              let approved = 0;
              for (const p of selected) {
                try {
                  const slug = slugify(p.optimized_title || p.seo_title || p.name);
                  const score = calcSeoScore(p);
                  await updateProduct.mutateAsync({ id: p.id, slug, seo_score: score, status: "active" });
                  approved++;
                } catch {}
                setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
              }
              toast({ title: `${approved} produtos aprovados para envio ao WooCommerce!` });
              setBulkProgress({ current: 0, total: 0, label: "" });
              setSelectedProducts(new Set());
            }}>
              <Check className="mr-2 h-3 w-3" />Aprovar
            </Button>
            {/* WooCommerce Sync */}
            {wooStores.length > 0 && (
              <div className="flex items-center gap-1">
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                <Select onValueChange={async (storeId) => {
                  const selected = products.filter(p => selectedProducts.has(p.id));
                  if (selected.length === 0) return;
                  setSyncingWoo(true);
                  setBulkEnriching(true);
                  const totalProducts = selected.length;
                  setBulkProgress({ current: 0, total: totalProducts, label: "WooCommerce" });
                  try {
                    const fileHintsByLookupKey = await buildCatalogFileHints(selected);
                    setBulkProgress({ current: 0, total: totalProducts, label: "WooCommerce – Enviando..." });

                    // Send ALL products in a single edge function call (the backend handles internal batching)
                    const allMapped = selected.map((p) => {
                      const skuKey = normalizeLookupKey(p.sku);
                      const nameKey = normalizeLookupKey(p.name);
                      const fileHint = (skuKey && fileHintsByLookupKey.get(skuKey)) || (nameKey && fileHintsByLookupKey.get(nameKey));
                      return {
                        ...p,
                        brand: p.brand || fileHint?.brand || null,
                        category_name: categories.find((c) => c.id === p.category_id)?.name || fileHint?.category_name || null,
                      };
                    });

                    const { data, error } = await supabase.functions.invoke("woo-sync", {
                      body: { action: "export", store_id: storeId, products: allMapped },
                    });

                    setBulkProgress({ current: totalProducts, total: totalProducts, label: "WooCommerce" });

                    if (error) {
                      toast({ title: "Erro na sincronização", description: error.message, variant: "destructive" });
                    } else if (data?.success) {
                      const sent = data.results?.reduce((sum: number, r: any) => sum + (r.created || 0) + (r.updated || 0), 0) || 0;
                      const failed = data.results?.reduce((sum: number, r: any) => sum + (r.error ? 1 : 0), 0) || 0;
                      if (sent > 0) toast({ title: `${sent} produtos criados/atualizados no WooCommerce!` });
                      if (failed > 0) toast({ title: `${failed} lotes falharam`, variant: "destructive" });
                    } else {
                      toast({ title: "Erro", description: data?.error || "Falha desconhecida", variant: "destructive" });
                    }
                  } catch (e: any) {
                    toast({ title: "Erro", description: e.message, variant: "destructive" });
                  }
                  setSyncingWoo(false);
                  setBulkEnriching(false);
                  setBulkProgress({ current: 0, total: 0, label: "" });
                  setSelectedProducts(new Set());
                }}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder={syncingWoo ? "Enviando..." : "Enviar p/ WooCommerce"} />
                  </SelectTrigger>
                  <SelectContent>
                    {wooStores.filter(s => s.is_active).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-1">
              <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
              <Select onValueChange={async (catalogId) => {
                const ids = Array.from(selectedProducts);
                const value = catalogId === "none" ? null : catalogId;
                setBulkProgress({ current: 0, total: ids.length, label: "Mover" });
                let moved = 0;
                for (const id of ids) {
                  try { await updateProduct.mutateAsync({ id, catalog_id: value } as any); moved++; } catch {}
                  setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
                }
                toast({ title: `${moved} produtos movidos!` });
                setBulkProgress({ current: 0, total: 0, label: "" });
                setSelectedProducts(new Set());
              }}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="Mover para..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem pasta</SelectItem>
                  {catalogs.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="destructive" size="sm" onClick={async () => {
              const ids = Array.from(selectedProducts);
              setBulkProgress({ current: 0, total: ids.length, label: "Apagar" });
              let deleted = 0;
              for (const id of ids) {
                try { await deleteProduct.mutateAsync(id); deleted++; } catch {}
                setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
              }
              toast({ title: `${deleted} produtos apagados!` });
              setBulkProgress({ current: 0, total: 0, label: "" });
              setSelectedProducts(new Set());
            }}>
              <Trash2 className="mr-2 h-3 w-3" />Apagar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedProducts(new Set())}>Limpar</Button>
          </div>
          {bulkProgress.total > 0 && (
            <div className="flex items-center gap-3 px-2">
              <Progress value={(bulkProgress.current / bulkProgress.total) * 100} className="flex-1 h-2" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {bulkProgress.label}: {bulkProgress.current}/{bulkProgress.total}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Single product operation progress */}
      {(enrichingId || scrapingId || generatingImageId) && (
        <div className="flex items-center gap-3 px-3 py-3 bg-primary/10 border border-primary/20 rounded-lg animate-pulse">
          <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
          <div className="flex-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" 
                style={{ width: '40%' }} />
            </div>
          </div>
          <span className="text-sm font-medium text-primary whitespace-nowrap">
            {enrichingId ? "⚡ IA Enriquecendo..." : scrapingId ? "🌐 Web Scraping..." : "🖼️ Gerando imagem..."}
            {" "}{products.find(p => p.id === (enrichingId || scrapingId || generatingImageId))?.name?.substring(0, 30)}
          </span>
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="p-2 w-8"><Checkbox checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0} onCheckedChange={toggleAll} /></th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-24">SKU</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[160px]">Título Original</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[160px]">Título Otimizado</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-32">Categoria</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[120px]">Desc. Curta</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-28">Slug</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-16">Tipo</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-36">Estado</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-20">Fases</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-12">SEO</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-28">
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={clearFilters} title="Limpar filtros">
                    <X className="h-3 w-3 mr-0.5" />Limpar
                  </Button>
                )}
              </th>
            </tr>
            {/* Filter row */}
            <tr className="border-b bg-muted/20">
              <td className="p-1"><Filter className="h-3 w-3 text-muted-foreground mx-auto" /></td>
              <td className="p-1"><Input placeholder="SKU..." value={columnFilters.sku || ""} onChange={e => setFilter("sku", e.target.value)} className="h-6 text-[10px] px-1" /></td>
              <td className="p-1"><Input placeholder="Título..." value={columnFilters.name || ""} onChange={e => setFilter("name", e.target.value)} className="h-6 text-[10px] px-1" /></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1">
                <Select value={columnFilters.status || "all"} onValueChange={v => setFilter("status", v === "all" ? "" : v)}>
                  <SelectTrigger className="h-6 text-[10px] px-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Publicado</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                    <SelectItem value="draft">Pendente</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-2 text-center">
                  <Checkbox checked={selectedProducts.has(product.id)} onCheckedChange={() => toggleProduct(product.id)} />
                </td>
                <td className="p-2">{renderCell(product, "sku")}</td>
                <td className="p-2">{renderCell(product, "name", "max-w-[200px]")}</td>
                <td className="p-2">{renderCell(product, "optimized_title", "max-w-[200px]")}</td>
                <td className="p-2">
                  <div className="text-xs truncate max-w-[130px]">{getCategoryName(product.category_id)}</div>
                </td>
                <td className="p-2">{renderCell(product, "short_description", "max-w-[150px]")}</td>
                <td className="p-2">{renderCell(product, "slug", "max-w-[120px]")}</td>
                <td className="p-2">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${product.product_type === "variable" ? "border-purple-500/40 text-purple-400" : "border-muted-foreground/30 text-muted-foreground"}`}>
                    {product.product_type === "variable" ? "Variável" : "Simples"}
                  </Badge>
                </td>
                <td className="p-2">{getStatusBadge(product)}</td>
                <td className="p-2">{getPhaseButtons(product)}</td>
                <td className="p-2">{getSeoScore(product)}</td>
                <td className="p-2">
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDetailProduct(product)} title="Editar">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => scrapeProduct(product)} disabled={scrapingId === product.id} title="Web scrape">
                      {scrapingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => enrichProduct(product)} disabled={enrichingId === product.id} title="Enriquecer IA">
                      {enrichingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => {
                        const slug = slugify(product.optimized_title || product.seo_title || product.name);
                        const score = calcSeoScore(product);
                        updateProduct.mutateAsync({ id: product.id, slug, seo_score: score, status: "active" });
                        toast({ title: "Produto aprovado para envio ao WooCommerce!" });
                      }} title="Aprovar">
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Product Detail Dialog */}
      <Dialog open={!!detailProduct} onOpenChange={() => setDetailProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{detailProduct?.name}</DialogTitle>
          </DialogHeader>
          {detailProduct && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">SKU:</span> {detailProduct.sku || "—"}</div>
                  <div><span className="text-muted-foreground">Marca:</span> {detailProduct.brand || "—"}</div>
                  <div><span className="text-muted-foreground">Custo:</span> R$ {Number(detailProduct.cost).toFixed(2)}</div>
                  <div><span className="text-muted-foreground">Preço:</span> R$ {Number(detailProduct.price).toFixed(2)}</div>
                  <div><span className="text-muted-foreground">Estoque:</span> {detailProduct.stock}</div>
                  <div><span className="text-muted-foreground">Slug:</span> {detailProduct.slug || "—"}</div>
                </div>

                {detailProduct.image_url && (
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="w-full max-h-48 object-contain rounded-lg border" />
                )}

                {(detailProduct.optimized_title || detailProduct.seo_title) && (
                  <div className="p-3 border rounded-lg bg-muted/30">
                    <h4 className="text-sm font-medium mb-1">SEO Preview</h4>
                    <p className="text-sm text-primary font-medium">{detailProduct.optimized_title || detailProduct.seo_title}</p>
                    <p className="text-xs text-muted-foreground">{detailProduct.meta_description || detailProduct.short_description}</p>
                    {detailProduct.slug && <p className="text-[10px] text-emerald-500 mt-1">/{detailProduct.slug}</p>}
                  </div>
                )}

                {detailProduct.description && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Descrição</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detailProduct.description}</p>
                  </div>
                )}

                {detailProduct.specifications && (detailProduct.specifications as any[]).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Especificações</h4>
                    <div className="grid grid-cols-2 gap-1">
                      {(detailProduct.specifications as any[]).map((spec: any, i: number) => (
                        <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1">
                          <span className="text-muted-foreground">{spec.name}:</span> {spec.value}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailProduct.tags && detailProduct.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Tags</h4>
                    <div className="flex flex-wrap gap-1">
                      {detailProduct.tags.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {detailProduct.last_enriched_at && (
                  <p className="text-[10px] text-muted-foreground">Último enriquecimento: {new Date(detailProduct.last_enriched_at).toLocaleString('pt-BR')}</p>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
