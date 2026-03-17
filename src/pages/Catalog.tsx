import { useState, useMemo, useRef } from "react";
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
import { Plus, Upload, Sheet, FileUp, Loader2, FolderPlus, Folder, FolderOpen, Trash2, Search, Pencil, ImageIcon, FileText, Download, File, X, Sparkles, Wand2, ZoomIn, CheckCircle2, AlertCircle, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SpreadsheetEditor } from "@/components/SpreadsheetEditor";
import { WooCommerceSync } from "@/components/WooCommerceSync";
import { ImportWizard, ParsedProduct } from "@/components/ImportWizard";
import { supabase } from "@/integrations/supabase/client";

function DetailField({ label, value, maxLines }: { label: string; value?: string | null; maxLines?: boolean }) {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground block mb-0.5">{label}</span>
      {value ? (
        <p className={`text-sm ${maxLines ? "line-clamp-4" : ""}`}>{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground/50 italic">—</p>
      )}
    </div>
  );
}

function OptimizedProductsTab({ products }: { products: Product[] }) {
  const [sortBy, setSortBy] = useState<"phase" | "date" | "seo">("date");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const enriched = products.filter(p => (p.enrichment_phase || 0) > 0 || p.last_enriched_at);
  const notEnriched = products.filter(p => !p.enrichment_phase && !p.last_enriched_at);

  const sorted = [...enriched].sort((a, b) => {
    if (sortBy === "phase") return (b.enrichment_phase || 0) - (a.enrichment_phase || 0);
    if (sortBy === "seo") return (b.seo_score || 0) - (a.seo_score || 0);
    return new Date(b.last_enriched_at || 0).getTime() - new Date(a.last_enriched_at || 0).getTime();
  });

  const getPhaseLabel = (phase: number) => {
    if (phase >= 3) return { label: "Completo", color: "bg-green-500/15 text-green-700 border-green-500/30" };
    if (phase === 2) return { label: "Fase 2 – SEO", color: "bg-blue-500/15 text-blue-700 border-blue-500/30" };
    if (phase === 1) return { label: "Fase 1 – Base", color: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30" };
    return { label: "Pendente", color: "bg-muted text-muted-foreground border-border" };
  };

  const getCompleteness = (p: Product) => {
    let score = 0;
    const total = 8;
    if (p.description) score++;
    if (p.short_description) score++;
    if (p.seo_title || p.optimized_title) score++;
    if (p.meta_description) score++;
    if (p.slug) score++;
    if (p.tags && p.tags.length > 0) score++;
    if (p.image_url) score++;
    if (p.brand) score++;
    return Math.round((score / total) * 100);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="font-medium">{enriched.length}</span>
          <span className="text-muted-foreground">otimizados</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{notEnriched.length}</span>
          <span className="text-muted-foreground">pendentes</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ordenar:</span>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Data</SelectItem>
              <SelectItem value="phase">Fase</SelectItem>
              <SelectItem value="seo">SEO Score</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {enriched.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Nenhum produto otimizado ainda</p>
          <p className="text-sm mt-1">Use o botão "Buscar Imagens e Dados" ou enriqueça produtos individualmente na Planilha.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(p => {
            const phase = getPhaseLabel(p.enrichment_phase || 0);
            const completeness = getCompleteness(p);
            const isExpanded = expandedId === p.id;

            return (
              <div key={p.id} className="border rounded-lg overflow-hidden transition-colors hover:border-primary/40">
                <button
                  className="w-full flex items-center gap-3 p-3 text-left"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  {getFirstImageUrl(p.image_url) ? (
                    <img src={getFirstImageUrl(p.image_url)!} alt={p.name} className="h-12 w-12 rounded object-cover flex-shrink-0 border" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.optimized_title || p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.sku ? `SKU: ${p.sku} · ` : ""}{p.brand || "Sem marca"}</p>
                  </div>
                  <Badge variant="outline" className={`text-xs ${phase.color}`}>{phase.label}</Badge>
                  <div className="flex items-center gap-1.5 flex-shrink-0" title={`${completeness}% completo`}>
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${completeness}%`,
                          backgroundColor: completeness >= 80 ? 'hsl(var(--chart-2))' : completeness >= 50 ? 'hsl(var(--chart-4))' : 'hsl(var(--chart-5))',
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8">{completeness}%</span>
                  </div>
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/30 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <DetailField label="Título Original" value={p.name} />
                      <DetailField label="Título Otimizado" value={p.optimized_title} />
                      <DetailField label="SEO Title" value={p.seo_title} />
                      <DetailField label="Slug" value={p.slug} />
                      <div className="md:col-span-2">
                        <DetailField label="Meta Descrição" value={p.meta_description} />
                      </div>
                      <div className="md:col-span-2">
                        <DetailField label="Descrição Curta" value={p.short_description} />
                      </div>
                      <div className="md:col-span-2">
                        <DetailField label="Descrição" value={p.description} maxLines />
                      </div>
                      {p.tags && p.tags.length > 0 && (
                        <div className="md:col-span-2">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Tags</span>
                          <div className="flex flex-wrap gap-1">
                            {p.tags.map((t, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground border-t">
                      <span>Fase: {p.enrichment_phase || 0}/3</span>
                      <span>SEO Score: {p.seo_score || 0}</span>
                      {p.last_enriched_at && (
                        <span>Última otimização: {new Date(p.last_enriched_at).toLocaleString("pt-PT")}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {notEnriched.length > 0 && (
        <div className="border border-dashed rounded-lg p-4">
          <p className="text-sm font-medium mb-1">{notEnriched.length} produtos ainda por otimizar</p>
          <p className="text-xs text-muted-foreground">
            {notEnriched.slice(0, 5).map(p => p.name).join(", ")}
            {notEnriched.length > 5 ? ` e mais ${notEnriched.length - 5}...` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Module-level helpers (shared across all components in this file) ───

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

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name","nome","title","titulo","designacao","description","descricao","product","produto","article","artigo","item","libelle","designation","woo:name"],
  description: ["content","conteudo","long description","descricao longa","description long","description longue","full description","corpo","body","woo:description"],
  short_description: ["short description","descricao curta","short_description","resumo","excerpt","intro","woo:short description"],
  sku: ["ref","sku","referencia","codigo","code","cod","reference","article number","part number","modelo","model","product code","item number","woo:sku"],
  ean: ["ean","gtin","barcode","codigo barras","upc","isbn","ean13","ean-13","codigo de barras"],
  cost: ["cost","custo","tarif","preco custo","net","euro","unit cost","wholesale","compra","prix achat","purchase price","buying price","cost price"],
  regular_price: ["regular price","regular_price","preco","pvp","price","sell","venda","retail","preco venda","prix","prix vente","woo:regular price"],
  sale_price: ["sale price","sale_price","preco promocional","promo","promotional","prix promo","offer price","discount price","woo:sale price"],
  stock: ["stock","estoque","qty","quantidade","inventory","units","std","quantity","disponivel","available","en stock"],
  brand: ["brand","marca","fabricante","manufacturer","vendor","fornecedor"],
  image_url: ["image","images","image url","image_url","imagens","imagem","foto","photo","thumbnail","picture","img","woo:images","gallery","galeria","image 1"],
  supplier_url: ["supplier_url","supplier url","fornecedor_url","fornecedor url","link fornecedor","url","link","product url","external url","woo:external url"],
  categories: ["categories","categorias","categoria","category","cat","woo:categories","product categories"],
  tags: ["tags","etiquetas","palavras chave","keywords","woo:tags"],
  weight: ["weight","peso","poids","woo:weight"],
  dimensions: ["dimensions","dimensoes","tamanho","size"],
  type: ["type","tipo","product type","woo:type"],
  status_field: ["status","estado","state","woo:published"],
  slug: ["slug","permalink","url amigavel"],
  tax_status: ["tax status","tax_status","imposto","taxable","woo:tax status"],
  tax_class: ["tax class","tax_class","classe imposto","woo:tax class"],
  meta_title: ["seo title","meta title","rank math title","seo titulo","woo:meta: rank_math_title"],
  meta_description: ["seo description","meta description","rank math description","seo descricao","woo:meta: rank_math_description"],
  focus_keyword: ["focus keyword","keyword","palavra chave","rank math focus keyword","woo:meta: rank_math_focus_keyword"],
};

const findVal = (row: Record<string, string>, keys: string[]): string => {
  const normalizedKeys = keys.map(normalizeHeader);
  for (const rk of Object.keys(row)) {
    const nh = normalizeHeader(rk);
    if (normalizedKeys.some((k) => nh.includes(k))) return row[rk];
  }
  return "";
};

const findField = (row: Record<string, string>, field: string): string => {
  return findVal(row, FIELD_ALIASES[field] || []);
};

const detectHeaderRowIndex = (rowsMatrix: unknown[][]) => {
  const headerHints = [
    "description","descricao","designacao","name","nome","ref","referencia","sku","codigo",
    "tarif","cost","custo","price","preco","pvp","stock","quantidade","qty",
    "image","imagem","imagens","foto","photo","thumbnail",
    "brand","marca","sale price","regular price","ean","categories","categoria",
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

const parseCsvLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  values.push(current.trim());
  return values;
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

  return breadcrumbParts.length > 0
    ? breadcrumbParts[breadcrumbParts.length - 1]
    : firstGroup;
};

const getAllImageUrls = (imageUrl?: string | null): string[] => {
  if (!imageUrl) return [];
  return imageUrl.split(/,\s*/).map(u => u.trim()).filter(u => u.startsWith("http"));
};

const getFirstImageUrl = (imageUrl?: string | null): string | null => {
  const urls = getAllImageUrls(imageUrl);
  return urls.length > 0 ? urls[0] : null;
};

const findExistingCatalogFile = async (params: {
  userId: string;
  catalogId: string | null;
  fileName: string;
  fileSize: number;
}) => {
  let query = supabase
    .from("catalog_files")
    .select("id")
    .eq("user_id", params.userId)
    .eq("file_name", params.fileName)
    .eq("file_size", params.fileSize)
    .limit(1);

  query = params.catalogId
    ? query.eq("catalog_id", params.catalogId)
    : query.is("catalog_id", null);

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao verificar ficheiro duplicado: ${error.message}`);

  return Boolean(data && data.length > 0);
};

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
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; currentName: string; found: number; catalogName?: string } | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);

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

  // helpers are module-level (above)

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

  const ensureImportCategories = async (items: ParsedProduct[]) => {
    if (!user) return new Map<string, string>();

    const desiredByKey = new Map<string, string>();
    for (const item of items) {
      const categoryName = extractPrimaryCategoryName(item.category_name);
      const key = normalizeLookupKey(categoryName);
      if (categoryName && key && !desiredByKey.has(key)) {
        desiredByKey.set(key, categoryName);
      }
    }

    if (desiredByKey.size === 0) return new Map<string, string>();

    const { data: existingCategories, error: existingError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("user_id", user.id);

    if (existingError) {
      throw new Error(`Falha ao ler categorias: ${existingError.message}`);
    }

    const categoryIdByNameKey = new Map<string, string>();
    for (const category of existingCategories || []) {
      categoryIdByNameKey.set(normalizeLookupKey(category.name), category.id);
    }

    const missingCategoryNames: string[] = [];
    for (const [key, name] of desiredByKey.entries()) {
      if (!categoryIdByNameKey.has(key)) {
        missingCategoryNames.push(name);
      }
    }

    if (missingCategoryNames.length > 0) {
      const { data: createdCategories, error: createError } = await supabase
        .from("categories")
        .insert(missingCategoryNames.map((name) => ({ user_id: user.id, name })) as any)
        .select("id, name");

      if (createError) {
        throw new Error(`Falha ao criar categorias: ${createError.message}`);
      }

      for (const category of createdCategories || []) {
        categoryIdByNameKey.set(normalizeLookupKey(category.name), category.id);
      }
    }

    return categoryIdByNameKey;
  };

  const attachImportedFile = async (file: File, catalogId: string | null, forcedType?: "excel" | "pdf" | "other") => {
    if (!user) throw new Error("Sessão expirada.");

    const alreadyAttached = await findExistingCatalogFile({
      userId: user.id,
      catalogId,
      fileName: file.name,
      fileSize: file.size,
    });

    if (alreadyAttached) return false;

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

    return true;
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
          const categoryName = extractPrimaryCategoryName(findField(row, "categories"));

          return {
            user_id: user.id,
            name,
            description: findVal(row, ["description long","descricao longa","long description"]) || null,
            short_description: findVal(row, ["short description","descricao curta","short_description"]) || null,
            sku: findVal(row, ["ref", "sku", "referencia", "codigo", "code", "cod"]) || null,
            ean: findVal(row, ["ean", "gtin", "barcode", "codigo barras"]) || null,
            cost: parseNum(findVal(row, ["cost", "custo", "tarif", "preco custo", "net", "euro"])),
            price: parseNum(findVal(row, ["price", "preco", "pvp", "sell", "venda", "sale price", "sale_price", "regular price", "regular_price"])),
            stock: Number.isFinite(stockRaw) ? Math.max(0, Math.trunc(stockRaw)) : 0,
            brand: findVal(row, ["brand", "marca"]) || null,
            image_url: findVal(row, ["image url", "image_url", "imagens", "imagem", "image", "images", "foto", "photo", "thumbnail"]) || null,
            supplier_url: findVal(row, ["supplier_url", "supplier url", "fornecedor_url", "fornecedor url", "link fornecedor"]) || null,
            category_name: categoryName || null,
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

      // Pass category_name through as-is (woo-sync will map to WooCommerce categories)
      const payloadToInsert = deduped.map((product) => {
        const { category_name, ...baseProduct } = product;
        return baseProduct;
      });

      const imported = await insertProductsInBatches(payloadToInsert);
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

  // Fetch images + enrich data for products
  const fetchAndEnrich = async (baseUrl?: string, alsoEnrich?: boolean) => {
    if (!user || fetchingImages) return;
    cancelRef.current = false;
    setCancelRequested(false);
    setFetchingImages(true);
    setImageDialogOpen(false);
    const currentCatalogName = selectedCatalogId === "all"
      ? "Todos os catálogos"
      : selectedCatalogId === "uncategorized"
      ? "Sem pasta"
      : catalogs.find(c => c.id === selectedCatalogId)?.name || "Catálogo";
    setFetchProgress(null);

    try {
      let query = supabase
        .from("products")
        .select("id, name, sku, supplier_url, image_url, description")
        .eq("user_id", user.id);

      if (selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized") {
        query = query.eq("catalog_id", selectedCatalogId);
      } else if (selectedCatalogId === "uncategorized") {
        query = query.is("catalog_id", null);
      }

      const { data: allCatalogProducts } = await query.limit(50);

      if (!allCatalogProducts || allCatalogProducts.length === 0) {
        toast({ title: "Nenhum produto encontrado", description: "Esta pasta não tem produtos." });
        return;
      }

      const noImageProducts = allCatalogProducts.filter(p => !p.image_url);
      const noDataProducts = alsoEnrich ? allCatalogProducts.filter(p => !p.description) : [];

      if (noImageProducts.length === 0 && noDataProducts.length === 0) {
        toast({ title: "Tudo completo!", description: "Todos os produtos já têm imagem e dados." });
        return;
      }

      const totalSteps = noImageProducts.length + noDataProducts.length;
      let currentStep = 0;
      let foundImages = 0;
      let enriched = 0;
      let wasCancelled = false;

      // Process images in batches of 5
      const IMG_BATCH = 5;
      for (let i = 0; i < noImageProducts.length; i += IMG_BATCH) {
        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        const batch = noImageProducts.slice(i, i + IMG_BATCH);
        setFetchProgress({
          current: currentStep,
          total: totalSteps,
          currentName: batch[0].name,
          found: foundImages,
          catalogName: currentCatalogName,
        });

        const { data, error } = await supabase.functions.invoke("web-scrape-product", {
          body: {
            action: "fetch_images",
            products: batch.map(p => ({ id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url })),
            base_supplier_url: baseUrl || null,
          },
        });

        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        if (!error && data?.success) {
          for (const r of (data.results || [])) {
            if (cancelRef.current) {
              wasCancelled = true;
              break;
            }

            if (r.success && r.image_url) {
              await supabase.from("products").update({ image_url: r.image_url }).eq("id", r.product_id);
              foundImages++;
            }
          }
        }

        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        currentStep += batch.length;
        setFetchProgress({ current: currentStep, total: totalSteps, currentName: "", found: foundImages, catalogName: currentCatalogName });
        queryClient.invalidateQueries({ queryKey: ["products"] });
      }

      // Process enrichment in batches of 5
      const ENRICH_BATCH = 5;
      for (let i = 0; i < noDataProducts.length; i += ENRICH_BATCH) {
        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        const batch = noDataProducts.slice(i, i + ENRICH_BATCH);
        setFetchProgress({
          current: currentStep,
          total: totalSteps,
          currentName: `Enriquecendo: ${batch[0].name}`,
          found: foundImages + enriched,
          catalogName: currentCatalogName,
        });

        const { data, error } = await supabase.functions.invoke("web-scrape-product", {
          body: {
            action: "bulk_enrich",
            products: batch.map(p => ({ id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url || baseUrl || null })),
            base_supplier_url: baseUrl || null,
          },
        });

        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        if (!error && data?.success) {
          for (const r of (data.results || [])) {
            if (cancelRef.current) {
              wasCancelled = true;
              break;
            }

            if (r.success && r.enriched) {
              const updates: Record<string, unknown> = {};
              if (r.enriched.description) updates.description = r.enriched.description;
              if (r.enriched.short_description) updates.short_description = r.enriched.short_description;
              if (r.enriched.optimized_title) updates.optimized_title = r.enriched.optimized_title;
              if (r.enriched.brand) updates.brand = r.enriched.brand;
              if (r.enriched.seo_title) updates.seo_title = r.enriched.seo_title;
              if (r.enriched.meta_description) updates.meta_description = r.enriched.meta_description;
              if (r.enriched.tags?.length) updates.tags = r.enriched.tags;
              if (r.enriched.specifications?.length) updates.specifications = r.enriched.specifications;

              if (Object.keys(updates).length > 0) {
                updates.last_enriched_at = new Date().toISOString();
                updates.enrichment_phase = 1;
                await supabase.from("products").update(updates as any).eq("id", r.product_id);
                enriched++;
              }
            }
          }
        }

        if (cancelRef.current) {
          wasCancelled = true;
          break;
        }

        currentStep += batch.length;
        setFetchProgress({ current: currentStep, total: totalSteps, currentName: "", found: foundImages + enriched, catalogName: currentCatalogName });
        queryClient.invalidateQueries({ queryKey: ["products"] });
      }

      if (wasCancelled || cancelRef.current) {
        toast({ title: "Cancelado", description: "A operação foi interrompida." });
        return;
      }

      setFetchProgress(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });

      const summary: string[] = [];
      if (foundImages > 0) summary.push(`${foundImages} imagem(ns)`);
      if (enriched > 0) summary.push(`${enriched} produto(s) enriquecido(s)`);

      if (summary.length > 0) {
        toast({ title: `Concluído: ${summary.join(" · ")}`, description: "Dados atualizados com sucesso." });
      } else {
        toast({ title: "Sem resultados", description: "Não foi possível encontrar dados adicionais." });
      }
    } catch (e: any) {
      console.warn("Fetch & enrich error:", e);
      toast({ title: "Erro", description: e.message || "Erro ao processar.", variant: "destructive" });
    } finally {
      setCancelRequested(false);
      setFetchingImages(false);
      setFetchProgress(null);
    }
  };

  const handleWizardConfirm = async (products: ParsedProduct[], files: File[]) => {
    if (!user) throw new Error("Sessão expirada.");

    const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;
    const categoryIdByNameKey = await ensureImportCategories(products);

    // Fetch existing products for this user to match against
    const { data: existingProducts } = await supabase
      .from("products")
      .select("id, sku, name, catalog_id")
      .eq("user_id", user.id);

    const existing = existingProducts || [];

    const bySku = new Map<string, { id: string; catalog_id: string | null }>();
    const byName = new Map<string, { id: string; catalog_id: string | null }>();
    for (const p of existing) {
      const normalizedSku = normalizeLookupKey(p.sku);
      const normalizedName = normalizeLookupKey(p.name);
      if (normalizedSku) bySku.set(normalizedSku, { id: p.id, catalog_id: p.catalog_id });
      if (normalizedName) byName.set(normalizedName, { id: p.id, catalog_id: p.catalog_id });
    }

    const toInsert: Array<Record<string, unknown>> = [];
    const toUpdate: Array<{ id: string; updates: Record<string, unknown> }> = [];
    const seenImportKeys = new Set<string>();

    for (const p of products) {
      const skuKey = normalizeLookupKey(p.sku);
      const nameKey = normalizeLookupKey(p.name);
      const dedupeKey = skuKey ? `sku:${skuKey}` : nameKey ? `name:${nameKey}` : "";
      if (!dedupeKey || seenImportKeys.has(dedupeKey)) continue;
      seenImportKeys.add(dedupeKey);

      const importedCategory = extractPrimaryCategoryName(p.category_name);
      const importedCategoryId = importedCategory
        ? categoryIdByNameKey.get(normalizeLookupKey(importedCategory)) || null
        : null;
      const match = (skuKey ? bySku.get(skuKey) : undefined) || byName.get(nameKey);

      if (match) {
        const updates: Record<string, unknown> = {};
        if (p.description) updates.description = p.description;
        if (p.sku) updates.sku = p.sku;
        if (p.cost > 0) updates.cost = p.cost;
        if (p.price > 0) updates.price = p.price;
        if (p.stock > 0) updates.stock = p.stock;
        if (p.brand) updates.brand = p.brand;
        if (p.supplier_url) updates.supplier_url = p.supplier_url;
        if (catalogId && !match.catalog_id) updates.catalog_id = catalogId;
        if (importedCategoryId) updates.category_id = importedCategoryId;

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
          category_id: importedCategoryId,
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
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
    ]);

    const parts: string[] = [];
    if (inserted > 0) parts.push(`${inserted} novos`);
    if (updated > 0) parts.push(`${updated} atualizados`);

    toast({
      title: `${parts.join(" · ")} produtos`,
      description: `${files.length} ficheiro(s) associado(s).`,
    });

  };

  // WooCommerce Excel Export
  const exportWooCommerceExcel = async () => {
    const XLSX = await import("xlsx");
    const allImages = await supabase.from("product_images").select("*").eq("user_id", user!.id);
    const imageMap = new Map<string, string[]>();
    for (const img of (allImages.data || [])) {
      const list = imageMap.get((img as any).product_id) || [];
      list.push((img as any).url);
      imageMap.set((img as any).product_id, list);
    }

    const cats = categories;
    const wooRows = filteredProducts.map(p => {
      const catName = cats.find(c => c.id === p.category_id)?.name || "";
      const imgs = imageMap.get(p.id) || [];
      const primaryImg = getFirstImageUrl(p.image_url);
      const allImgs = primaryImg ? [primaryImg, ...imgs.filter(u => u !== primaryImg)] : imgs;

      return {
        "Type": p.product_type === "variable" ? "variable" : "simple",
        "SKU": p.sku || "",
        "Name": p.optimized_title || p.name || "",
        "Published": p.status === "active" ? 1 : 0,
        "Is featured?": 0,
        "Visibility in catalog": "visible",
        "Short description": p.short_description || "",
        "Description": p.description || "",
        "Tax status": "taxable",
        "Tax class": "",
        "In stock?": p.stock > 0 ? 1 : 0,
        "Stock": p.stock,
        "Regular price": p.price || "",
        "Sale price": "",
        "Categories": catName,
        "Tags": (p.tags || []).join(", "),
        "Images": allImgs.join(", "),
        "External URL": p.supplier_url || "",
        "Brand": p.brand || "",
        "EAN": p.ean || "",
        "SEO Title": p.seo_title || "",
        "Meta Description": p.meta_description || "",
        "Slug": p.slug || "",
        "Meta: rank_math_title": p.seo_title || "",
        "Meta: rank_math_description": p.meta_description || "",
        "Meta: rank_math_focus_keyword": (p.tags || [])[0] || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(wooRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, `woocommerce-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: `${wooRows.length} produtos exportados para WooCommerce!` });
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
        <div className="flex gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={importing}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar / Atualizar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => {
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
                <Sheet className="mr-2 h-4 w-4" />
                Excel / CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
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
                <FileUp className="mr-2 h-4 w-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                // Switch to WooCommerce tab for import
                const wooTab = document.querySelector('[data-value="woo"]') as HTMLElement;
                if (wooTab) wooTab.click();
              }}>
                <Download className="mr-2 h-4 w-4" />
                WooCommerce (API)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" disabled={fetchingImages} onClick={() => {
            const currentCatalog = catalogs.find(c => c.id === selectedCatalogId);
            setSupplierBaseUrl(currentCatalog?.supplier_url || "");
            setImageDialogOpen(true);
          }}>
            {fetchingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
            Buscar Imagens
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingProduct(null); }}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Produto</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProduct ? "Editar Produto" : "Novo Produto"}</DialogTitle>
              </DialogHeader>
              <InlineProductForm
                product={editingProduct}
                categories={categories}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditCatalogData({ id: cat.id, name: cat.name, supplier_url: cat.supplier_url || "" });
                    setEditCatalogDialogOpen(true);
                  }}
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

        <Button variant="outline" size="sm" onClick={() => setShowNewCatalogDialog(true)} className="gap-1.5 border-dashed">
          <FolderPlus className="h-3.5 w-3.5" />
          Nova Pasta
        </Button>
      </div>

      {/* Progress bar for image fetching / enrichment */}
      {fetchProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium">
                  {fetchProgress.catalogName && (
                    <span className="text-primary mr-1">[{fetchProgress.catalogName}]</span>
                  )}
                  {fetchProgress.current}/{fetchProgress.total} produto(s)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {cancelRequested
                    ? "A cancelar..."
                    : fetchProgress.found > 0
                    ? `${fetchProgress.found} encontrado(s)`
                    : "A procurar..."}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancelRequested}
                  className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    cancelRef.current = true;
                    setCancelRequested(true);
                    setFetchProgress(prev => (prev ? { ...prev, currentName: "A cancelar..." } : prev));
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  {cancelRequested ? "A cancelar" : "Cancelar"}
                </Button>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${fetchProgress.total > 0 ? (fetchProgress.current / fetchProgress.total) * 100 : 0}%` }}
              />
            </div>
            {fetchProgress.currentName && (
              <p className="text-xs text-muted-foreground truncate">
                {fetchProgress.currentName}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="spreadsheet" className="w-full">
        <TabsList>
          <TabsTrigger value="spreadsheet" className="gap-1.5">
            <Sheet className="h-3.5 w-3.5" />Planilha
          </TabsTrigger>
          <TabsTrigger value="optimized" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />Otimizados
          </TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" />Imagens
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />Ficheiros
          </TabsTrigger>
          <TabsTrigger value="woo" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />WooCommerce
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spreadsheet">
          <Card>
            <CardContent className="pt-4">
              <SpreadsheetEditor products={filteredProducts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optimized">
          <Card>
            <CardContent className="pt-4">
              <OptimizedProductsTab products={filteredProducts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="images">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground mb-4 flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Visualize e gere imagens para os seus produtos. Clique numa imagem para ver opções.
              </div>
              <ImageGalleryTab products={filteredProducts} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files">
          <CatalogFilesTab selectedCatalogId={selectedCatalogId} />
        </TabsContent>

        <TabsContent value="woo">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Exportar para WooCommerce</h3>
                  <p className="text-sm text-muted-foreground">Gera um ficheiro Excel com todas as colunas do formato WooCommerce, incluindo SEO Rank Math e galeria de imagens.</p>
                </div>
                <Button onClick={exportWooCommerceExcel} className="gap-2" disabled={filteredProducts.length === 0}>
                  <Download className="h-4 w-4" />
                  Exportar Excel ({filteredProducts.length})
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="mt-4">
            <WooCommerceSync />
          </div>
        </TabsContent>
      </Tabs>

      <ImportWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setWizardFiles([]); }}
        files={wizardFiles}
        onConfirmImport={handleWizardConfirm}
      />

      {/* New Catalog dialog */}
      <Dialog open={showNewCatalogDialog} onOpenChange={setShowNewCatalogDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da pasta *</Label>
              <Input
                placeholder="Ex: Plasgourmet"
                value={newCatalogName}
                onChange={(e) => setNewCatalogName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newCatalogName.trim()) handleCreateCatalog(); }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Site do Fornecedor (opcional)</Label>
              <Input
                placeholder="https://plasgourmet.com"
                value={newCatalogSupplierUrl}
                onChange={(e) => setNewCatalogSupplierUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usado para buscar imagens e enriquecer dados dos produtos
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowNewCatalogDialog(false); setNewCatalogName(""); setNewCatalogSupplierUrl(""); }}>Cancelar</Button>
              <Button onClick={handleCreateCatalog} disabled={!newCatalogName.trim()}>
                <FolderPlus className="mr-2 h-4 w-4" />Criar Pasta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Catalog dialog */}
      <Dialog open={editCatalogDialogOpen} onOpenChange={setEditCatalogDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da pasta</Label>
              <Input
                value={editCatalogData.name}
                onChange={(e) => setEditCatalogData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Site do Fornecedor</Label>
              <Input
                placeholder="https://plasgourmet.com"
                value={editCatalogData.supplier_url}
                onChange={(e) => setEditCatalogData(prev => ({ ...prev, supplier_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Usado para buscar imagens e enriquecer dados dos produtos
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditCatalogDialogOpen(false)}>Cancelar</Button>
              <Button onClick={async () => {
                await updateCatalog.mutateAsync({
                  id: editCatalogData.id,
                  name: editCatalogData.name.trim() || undefined,
                  supplier_url: editCatalogData.supplier_url.trim() || null,
                });
                setEditCatalogDialogOpen(false);
              }} disabled={!editCatalogData.name.trim()}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image fetch + enrich dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar Imagens e Enriquecer Dados</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Procura imagens e informação adicional (descrições, especificações, SEO) para os produtos da pasta selecionada.
            </p>
            <div className="space-y-2">
              <Label>URL do Fornecedor (opcional)</Label>
              <Input
                placeholder="https://plasgourmet.com"
                value={supplierBaseUrl}
                onChange={(e) => setSupplierBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Melhora a precisão da busca de imagens e dados
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                disabled={fetchingImages}
                onClick={() => fetchAndEnrich(supplierBaseUrl.trim() || undefined, true)}
                className="w-full"
              >
                {fetchingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar Imagens + Enriquecer Dados
              </Button>
              <Button
                variant="outline"
                disabled={fetchingImages}
                onClick={() => fetchAndEnrich(supplierBaseUrl.trim() || undefined, false)}
                className="w-full"
              >
                {fetchingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Apenas Imagens
              </Button>
            </div>
          </div>
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
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [extractingFileId, setExtractingFileId] = useState<string | null>(null);
  const [syncingFileId, setSyncingFileId] = useState<string | null>(null);

  const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

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
      if (normalizedKeys.some((k) => normalizeHeader(rk).includes(k))) return row[rk];
    }
    return "";
  };

  const detectHeaderRowIndex = (rowsMatrix: unknown[][]) => {
    const headerHints = ["description","descricao","designacao","name","nome","ref","referencia","sku","tarif","cost","custo","price","preco","pvp","stock","quantidade","qty","image","imagem","imagens","foto","brand","marca","ean","sale price","categories","categoria"];
    let bestIndex = 0, bestScore = -1;
    for (let i = 0; i < Math.min(40, rowsMatrix.length); i++) {
      const cells = ((rowsMatrix[i] || []) as unknown[]).map(c => normalizeHeader(c)).filter(Boolean);
      if (cells.length < 2) continue;
      const score = cells.reduce((acc: number, cell: string) => acc + (headerHints.some(h => cell.includes(h)) ? 3 : /[a-zA-ZÀ-ÿ]/.test(cell) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  };

  const extractProductsFromFile = async (file: { id: string; file_name: string; file_url: string; file_type: string }) => {
    if (!user) return;
    setExtractingFileId(file.id);
    try {
      const response = await fetch(file.file_url);
      if (!response.ok) throw new Error("Não foi possível descarregar o ficheiro.");
      const blob = await response.blob();
      const ext = file.file_name.split(".").pop()?.toLowerCase();

      let productsToInsert: Array<Record<string, unknown>> = [];

      if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        if (ext === "csv") {
          const text = await blob.text();
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length < 2) throw new Error("CSV sem dados suficientes.");
          const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
          const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
          for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
            const name = findField(row, "name").trim();
            if (!name) continue;
            const regularPrice = parseNum(findField(row, "regular_price"));
            const salePrice = parseNum(findField(row, "sale_price"));
            productsToInsert.push({
              user_id: user.id, name,
              description: findField(row, "description") || null,
              short_description: findField(row, "short_description") || null,
              sku: findField(row, "sku") || null,
              ean: findField(row, "ean") || null,
              cost: parseNum(findField(row, "cost")),
              price: regularPrice || salePrice,
              stock: Math.max(0, Math.trunc(parseNum(findField(row, "stock")))),
              brand: findField(row, "brand") || null,
              image_url: findField(row, "image_url") || null,
              supplier_url: findField(row, "supplier_url") || null,
              product_type: findField(row, "type")?.toLowerCase().includes("variable") ? "variable" : "simple",
              seo_title: findField(row, "meta_title") || null,
              meta_description: findField(row, "meta_description") || null,
              slug: findField(row, "slug") || null,
              tags: findField(row, "tags") ? findField(row, "tags").split(",").map((t: string) => t.trim()).filter(Boolean) : null,
              status: "draft", catalog_id: catalogId,
            });
          }
        } else {
          const XLSX = await import("xlsx");
          const buffer = await blob.arrayBuffer();
          const wb = XLSX.read(buffer, { type: "array" });
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
            const headerRowIdx = detectHeaderRowIndex(allRows as unknown[][]);
            const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", range: headerRowIdx });
            for (const r of jsonData) {
              const row: Record<string, string> = {};
              Object.keys(r).forEach(k => { row[String(k).trim()] = String(r[k] ?? "").trim(); });
              const directName = findField(row, "name");
              const fallbackName = Object.values(row).find(v => { const val = String(v || "").trim(); return val.length > 2 && /[a-zA-ZÀ-ÿ]/.test(val) && !/^\d+$/.test(val); }) || "";
              const name = (directName || fallbackName).trim();
              if (!name) continue;
              const regularPrice = parseNum(findField(row, "regular_price"));
              const salePrice = parseNum(findField(row, "sale_price"));
              productsToInsert.push({
                user_id: user.id, name,
                description: findField(row, "description") || null,
                short_description: findField(row, "short_description") || null,
                sku: findField(row, "sku") || null,
                ean: findField(row, "ean") || null,
                cost: parseNum(findField(row, "cost")),
                price: regularPrice || salePrice,
                stock: Math.max(0, Math.trunc(parseNum(findField(row, "stock")))),
                brand: findField(row, "brand") || null,
                image_url: findField(row, "image_url") || null,
                supplier_url: findField(row, "supplier_url") || null,
                product_type: findField(row, "type")?.toLowerCase().includes("variable") ? "variable" : "simple",
                seo_title: findField(row, "meta_title") || null,
                meta_description: findField(row, "meta_description") || null,
                slug: findField(row, "slug") || null,
                tags: findField(row, "tags") ? findField(row, "tags").split(",").map((t: string) => t.trim()).filter(Boolean) : null,
                status: "draft", catalog_id: catalogId,
              });
            }
          }
        }
      } else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Extract text page by page and try to identify products from raw text
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const items = content.items as any[];
          const text = items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim();
          if (text.length > 10) pageTexts.push(text);
        }
        if (pageTexts.length === 0) throw new Error("PDF vazio — sem texto extraível.");

        // Client-side extraction: find prices (€/$) and product-like names
        const priceRegex = /(\d[\d.,]*)\s*[€$]/g;
        const eurRegex = /[€$]\s*(\d[\d.,]*)/g;
        const fullText = pageTexts.join("\n");

        // Try to find product blocks: split by pages, look for identifiable product sections
        for (let pi = 0; pi < pageTexts.length; pi++) {
          const pageText = pageTexts[pi];
          // Find all prices on this page
          const prices: number[] = [];
          let m;
          const combinedPriceRegex = /(\d[\d.,]*)\s*€|€\s*(\d[\d.,]*)/g;
          while ((m = combinedPriceRegex.exec(pageText)) !== null) {
            const val = parseNum(m[1] || m[2]);
            if (val > 0) prices.push(val);
          }

          // Extract uppercase words sequences as potential product names
          const nameMatches = pageText.match(/[A-Z][A-Z0-9&\-\s]{3,30}(?=[^a-z])/g) || [];
          const potentialNames = nameMatches
            .map(n => n.trim())
            .filter(n => n.length > 3 && !/^\d+$/.test(n) && !/^(THE|AND|FOR|WITH|FROM)$/i.test(n));

          // If we found at least a name, create a product entry
          if (potentialNames.length > 0) {
            const mainName = potentialNames[0];
            // Check if we already have this name
            const exists = productsToInsert.some(p => String(p.name).toLowerCase() === mainName.toLowerCase());
            if (!exists) {
              // Use first price as cost, second as selling price (common in catalogs)
              const cost = prices.length > 0 ? prices[0] : 0;
              const price = prices.length > 1 ? prices[prices.length - 1] : cost;

              productsToInsert.push({
                user_id: user.id,
                name: mainName,
                description: pageText.substring(0, 500),
                sku: null, cost, price, stock: 0,
                brand: null, status: "draft" as const,
                catalog_id: catalogId,
              });
            }
          } else if (prices.length > 0 && pageText.length > 20) {
            // No clear name found but has prices — use first meaningful text chunk as name
            const firstChunk = pageText.substring(0, 80).replace(/\s+/g, " ").trim();
            if (firstChunk.length > 5) {
              productsToInsert.push({
                user_id: user.id,
                name: firstChunk,
                description: pageText.substring(0, 500),
                sku: null, cost: prices[0], price: prices[prices.length - 1] || prices[0],
                stock: 0, brand: null, status: "draft" as const,
                catalog_id: catalogId,
              });
            }
          }
        }
      } else {
        throw new Error("Formato não suportado para extração. Use Excel, CSV ou PDF.");
      }

      // Dedup dentro do próprio ficheiro
      const deduped: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      for (const p of productsToInsert) {
        const skuKey = normalizeLookupKey(p.sku);
        const nameKey = normalizeLookupKey(p.name);
        const key = skuKey ? `sku:${skuKey}` : nameKey ? `name:${nameKey}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(p);
      }

      if (deduped.length === 0) throw new Error("Nenhum produto encontrado no ficheiro.");

      // Evita inserir produtos já existentes (re-extração do mesmo ficheiro)
      let existingQuery = supabase
        .from("products")
        .select("sku, name")
        .eq("user_id", user.id);

      if (catalogId) existingQuery = existingQuery.eq("catalog_id", catalogId);

      const { data: existingProducts, error: existingError } = await existingQuery;
      if (existingError) throw new Error(existingError.message);

      const existingSkuKeys = new Set<string>();
      const existingNameKeys = new Set<string>();
      for (const existing of existingProducts || []) {
        const skuKey = normalizeLookupKey(existing.sku);
        const nameKey = normalizeLookupKey(existing.name);
        if (skuKey) existingSkuKeys.add(skuKey);
        if (nameKey) existingNameKeys.add(nameKey);
      }

      const toInsert = deduped.filter((p) => {
        const skuKey = normalizeLookupKey(p.sku);
        const nameKey = normalizeLookupKey(p.name);
        const alreadyExists = (skuKey && existingSkuKeys.has(skuKey)) || (nameKey && existingNameKeys.has(nameKey));
        if (alreadyExists) return false;

        if (skuKey) existingSkuKeys.add(skuKey);
        if (nameKey) existingNameKeys.add(nameKey);
        return true;
      });

      if (toInsert.length === 0) {
        toast({ title: "Sem novos produtos", description: "Este ficheiro já foi extraído anteriormente para esta pasta." });
        return;
      }

      // Insert in batches
      const BATCH_SIZE = 100;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const chunk = toInsert.slice(i, i + BATCH_SIZE);
        const { data: result, error: insertErr } = await supabase.from("products").insert(chunk as any).select("id");
        if (insertErr) throw new Error(insertErr.message);
        inserted += result?.length ?? chunk.length;
      }

      await queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({ title: `${inserted} produtos extraídos de "${file.file_name}"!` });
    } catch (e: any) {
      toast({ title: "Erro na extração", description: e.message, variant: "destructive" });
    } finally {
      setExtractingFileId(null);
    }
  };

  // Sync: re-read Excel and update existing products by SKU (fill missing image_url etc.)
  const syncProductsFromFile = async (file: { id: string; file_name: string; file_url: string; file_type: string }) => {
    if (!user) return;
    setSyncingFileId(file.id);
    try {
      const response = await fetch(file.file_url);
      if (!response.ok) throw new Error("Não foi possível descarregar o ficheiro.");
      const blob = await response.blob();
      const ext = file.file_name.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xls" && ext !== "csv") {
        throw new Error("Sincronização só é suportada para ficheiros Excel/CSV.");
      }

      // Parse rows from file
      const rows: Record<string, string>[] = [];
      if (ext === "csv") {
        const text = await blob.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) throw new Error("CSV sem dados.");
        const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
          rows.push(row);
        }
      } else {
        const XLSX = await import("xlsx");
        const buffer = await blob.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
          const headerRowIdx = detectHeaderRowIndex(allRows as unknown[][]);
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", range: headerRowIdx });
          for (const r of jsonData) {
            const row: Record<string, string> = {};
            Object.keys(r).forEach(k => { row[String(k).trim()] = String(r[k] ?? "").trim(); });
            rows.push(row);
          }
        }
      }

      // Get existing products for this catalog
      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;
      let query = supabase.from("products").select("id, sku, name, image_url").eq("user_id", user.id);
      if (catalogId) query = query.eq("catalog_id", catalogId);
      const { data: existingProducts } = await query;
      if (!existingProducts || existingProducts.length === 0) throw new Error("Nenhum produto encontrado para sincronizar.");

      // Build lookup by SKU and name
      const bySkuMap = new Map<string, typeof existingProducts[0]>();
      const byNameMap = new Map<string, typeof existingProducts[0]>();
      for (const p of existingProducts) {
        if (p.sku) bySkuMap.set(p.sku.toLowerCase().trim(), p);
        if (p.name) byNameMap.set(p.name.toLowerCase().trim(), p);
      }

      let updated = 0;
      for (const row of rows) {
        const sku = findField(row, "sku").trim();
        const name = findField(row, "name").trim();
        const rawImageUrl = findField(row, "image_url").trim();
        const supplierUrl = findField(row, "supplier_url").trim();
        const ean = findField(row, "ean").trim();
        const brand = findField(row, "brand").trim();
        const description = findField(row, "description").trim();
        const shortDesc = findField(row, "short_description").trim();
        const seoTitle = findField(row, "meta_title").trim();
        const metaDesc = findField(row, "meta_description").trim();

        // Match product by SKU first, then by name
        const match = (sku && bySkuMap.get(sku.toLowerCase())) || (name && byNameMap.get(name.toLowerCase()));
        if (!match) continue;

        // Split multiple image URLs (comma or space separated)
        const imageUrls = rawImageUrl
          ? rawImageUrl.split(/,\s*/).map(u => u.trim()).filter(u => u.startsWith("http"))
          : [];

        const primaryImage = imageUrls[0] || null;
        const extraImages = imageUrls.slice(1);

        // Build update object
        const updates: Record<string, unknown> = {};
        if (primaryImage) updates.image_url = primaryImage;
        if (ean) updates.ean = ean;
        if (supplierUrl) updates.supplier_url = supplierUrl;
        if (brand) updates.brand = brand;
        if (description) updates.description = description;
        if (shortDesc) updates.short_description = shortDesc;
        if (seoTitle) updates.seo_title = seoTitle;
        if (metaDesc) updates.meta_description = metaDesc;

        if (Object.keys(updates).length > 0) {
          await supabase.from("products").update(updates as any).eq("id", match.id);
          updated++;
        }

        // Insert extra images into product_images table
        if (extraImages.length > 0) {
          const imagesToInsert = extraImages.map((url, idx) => ({
            product_id: match.id,
            user_id: user.id,
            url,
            type: "original",
            is_primary: false,
          }));
          // Also insert primary as product_images entry
          imagesToInsert.unshift({
            product_id: match.id,
            user_id: user.id,
            url: primaryImage!,
            type: "original",
            is_primary: true,
          });
          await supabase.from("product_images").insert(imagesToInsert as any);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["product_images"] });
      toast({ title: `${updated} produtos atualizados de "${file.file_name}"!` });
    } catch (e: any) {
      toast({ title: "Erro na sincronização", description: e.message, variant: "destructive" });
    } finally {
      setSyncingFileId(null);
    }
  };

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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    disabled={extractingFileId === f.id || f.file_type === "other"}
                    onClick={(e) => { e.stopPropagation(); extractProductsFromFile(f); }}
                  >
                    {extractingFileId === f.id ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />Extraindo...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" />Extrair Produtos</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    disabled={syncingFileId === f.id || f.file_type === "other"}
                    onClick={(e) => { e.stopPropagation(); syncProductsFromFile(f); }}
                  >
                    {syncingFileId === f.id ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />Sincronizando...</>
                    ) : (
                      <><ArrowUpDown className="h-3 w-3" />Sincronizar</>
                    )}
                  </Button>
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

function InlineProductForm({
  product,
  categories,
  selectedCatalogId,
  onSubmit,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  selectedCatalogId: string;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [cost, setCost] = useState(product?.cost?.toString() || "0");
  const [price, setPrice] = useState(product?.price?.toString() || "0");
  const [stock, setStock] = useState(product?.stock?.toString() || "0");
  const [brand, setBrand] = useState(product?.brand || "");
  const [description, setDescription] = useState(product?.description || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "");
  const [supplierUrl, setSupplierUrl] = useState(product?.supplier_url || "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;
      await onSubmit({
        name: name.trim(),
        sku: sku.trim() || null,
        cost: parseFloat(cost) || 0,
        price: parseFloat(price) || 0,
        stock: parseInt(stock) || 0,
        brand: brand.trim() || null,
        description: description.trim() || null,
        category_id: categoryId || null,
        supplier_url: supplierUrl.trim() || null,
        catalog_id: product ? undefined : catalogId,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label>Nome *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label>SKU</Label>
          <Input value={sku} onChange={e => setSku(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Marca</Label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Custo</Label>
          <Input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Preço</Label>
          <Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Stock</Label>
          <Input type="number" value={stock} onChange={e => setStock(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label>URL Fornecedor</Label>
          <Input value={supplierUrl} onChange={e => setSupplierUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="col-span-2 space-y-1">
          <Label>Descrição</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={!name.trim() || saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {product ? "Guardar" : "Criar Produto"}
      </Button>
    </form>
  );
}




function ImageGalleryTab({ products }: { products: Product[] }) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const withImage = products.filter(p => getFirstImageUrl(p.image_url));
  const withoutImage = products.filter(p => !getFirstImageUrl(p.image_url));

  const handleGenerateAiImage = async (product: Product) => {
    if (generatingAi) return;
    setGeneratingAi(true);
    try {
      const prompt = `Professional product photo of "${product.name}"${product.description ? `. ${product.description.substring(0, 200)}` : ""}. Clean white background, studio lighting, e-commerce product photography, high quality, sharp details.`;

      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: {
          action: "generate_image",
          product: { name: product.name, description: product.description },
        },
      });

      if (error || !data?.success) {
        toast({ title: "Erro ao gerar imagem", description: data?.error || "Tente novamente.", variant: "destructive" });
        return;
      }

      if (data.image_url) {
        await supabase.from("products").update({ image_url: data.image_url } as any).eq("id", product.id);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        toast({ title: "Imagem gerada com sucesso!" });
        setSelectedProduct({ ...product, image_url: data.image_url });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleOptimizeImage = async (product: Product) => {
    if (!product.image_url || optimizing) return;
    setOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: {
          action: "optimize_image",
          product: { image_url: product.image_url, product_name: product.name },
        },
      });

      if (error || !data?.success) {
        toast({ title: "Erro ao otimizar", description: data?.error || "Tente novamente.", variant: "destructive" });
        return;
      }

      if (data.image_url) {
        await supabase.from("products").update({ image_url: data.image_url } as any).eq("id", product.id);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        toast({ title: "Imagem otimizada!" });
        setSelectedProduct({ ...product, image_url: data.image_url });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setOptimizing(false);
    }
  };

  const handleGenerateLifestyle = async (product: Product) => {
    if (!product.image_url || generatingAi) return;
    setGeneratingAi(true);
    try {
      const prompt = `Take this product "${product.name}" and place it in a realistic lifestyle environment. Professional product photography in a natural setting, warm lighting, lifestyle context, editorial style.`;

      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: {
          action: "generate_scene",
          product: { image_url: product.image_url, product_name: product.name, description: product.description },
        },
      });

      if (error || !data?.success) {
        toast({ title: "Erro ao gerar", description: data?.error || "Tente novamente.", variant: "destructive" });
        return;
      }

      if (data.image_url) {
        queryClient.invalidateQueries({ queryKey: ["product_images"] });
        toast({ title: "Imagem lifestyle gerada!" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingAi(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{withImage.length} com imagem · {withoutImage.length} sem imagem</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {products.map(product => (
          <div
            key={product.id}
            className="border rounded-lg p-3 text-center space-y-2 hover:shadow-md transition-shadow cursor-pointer group relative"
            onClick={() => { setSelectedProduct(product); setSelectedImageIdx(0); }}
          >
            {getFirstImageUrl(product.image_url) ? (
              <div className="relative">
                <img src={getFirstImageUrl(product.image_url)!} alt={product.name} className="w-full h-28 object-contain rounded" />
                {getAllImageUrls(product.image_url).length > 1 && (
                  <span className="absolute top-1 right-1 bg-foreground/70 text-background text-[10px] px-1.5 py-0.5 rounded-full">
                    +{getAllImageUrls(product.image_url).length - 1}
                  </span>
                )}
                <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/10 rounded transition-colors flex items-center justify-center">
                  <ZoomIn className="h-6 w-6 text-background opacity-0 group-hover:opacity-80 transition-opacity" />
                </div>
              </div>
            ) : (
              <div className="w-full h-28 bg-muted rounded flex flex-col items-center justify-center text-muted-foreground">
                <ImageIcon className="h-8 w-8 mb-1" />
                <span className="text-xs">Sem imagem</span>
              </div>
            )}
            <p className="text-xs font-medium truncate">{product.name}</p>
            {product.sku && <p className="text-[10px] text-muted-foreground">{product.sku}</p>}
          </div>
        ))}
      </div>

      {/* Lightbox / Product Image Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={(open) => { if (!open) setSelectedProduct(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{selectedProduct?.name}</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              {(() => {
                const allUrls = getAllImageUrls(selectedProduct.image_url);
                const currentUrl = allUrls[selectedImageIdx] || allUrls[0];
                return (
                  <>
                    <div className="relative flex items-center justify-center bg-muted/30 rounded-lg p-4 min-h-[300px]">
                      {currentUrl ? (
                        <>
                          <img
                            src={currentUrl}
                            alt={selectedProduct.name}
                            className="max-w-full max-h-[400px] object-contain rounded"
                          />
                          {allUrls.length > 1 && (
                            <>
                              <button
                                className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border rounded-full p-1.5 shadow transition-colors"
                                onClick={() => setSelectedImageIdx((prev) => (prev - 1 + allUrls.length) % allUrls.length)}
                              >
                                <ChevronLeft className="h-5 w-5" />
                              </button>
                              <button
                                className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border rounded-full p-1.5 shadow transition-colors"
                                onClick={() => setSelectedImageIdx((prev) => (prev + 1) % allUrls.length)}
                              >
                                <ChevronRight className="h-5 w-5" />
                              </button>
                              <span className="absolute bottom-2 right-2 text-xs bg-background/80 border rounded px-2 py-0.5">
                                {selectedImageIdx + 1} / {allUrls.length}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <div className="text-center text-muted-foreground space-y-2">
                          <ImageIcon className="h-16 w-16 mx-auto" />
                          <p>Este produto não tem imagem</p>
                        </div>
                      )}
                    </div>
                    {allUrls.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {allUrls.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`${selectedProduct.name} ${idx + 1}`}
                            className={cn(
                              "h-20 w-20 object-contain rounded border-2 cursor-pointer hover:border-primary transition-colors flex-shrink-0",
                              idx === selectedImageIdx ? "border-primary" : "border-transparent"
                            )}
                            onClick={() => setSelectedImageIdx(idx)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}

              {selectedProduct.sku && (
                <p className="text-sm text-muted-foreground">SKU: {selectedProduct.sku}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={generatingAi}
                  onClick={() => handleGenerateAiImage(selectedProduct)}
                >
                  {generatingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Gerar com IA
                </Button>

                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!getFirstImageUrl(selectedProduct.image_url) || optimizing}
                  onClick={() => handleOptimizeImage(selectedProduct)}
                >
                  {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Otimizar
                </Button>

                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!getFirstImageUrl(selectedProduct.image_url) || generatingAi}
                  onClick={() => handleGenerateLifestyle(selectedProduct)}
                >
                  {generatingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  Ambiente Real
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
