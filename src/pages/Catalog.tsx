import { useState, useCallback } from "react";
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, Product } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Search, Upload, Sheet, FileUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SpreadsheetEditor } from "@/components/SpreadsheetEditor";
import { WooCommerceSync } from "@/components/WooCommerceSync";
import { supabase } from "@/integrations/supabase/client";

export default function Catalog() {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !(p.sku || "").toLowerCase().includes(q)) return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    return true;
  });

  // Excel/CSV import
  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    setImporting(true);
    try {
      let rows: Record<string, string>[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
        rows = jsonData.map(r => {
          const out: Record<string, string> = {};
          Object.keys(r).forEach(k => { out[k.trim().toLowerCase()] = String(r[k]).trim(); });
          return out;
        });
      } else if (ext === "csv") {
        const text = await file.text();
        const lines = text.split("\n").filter(Boolean);
        const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",").map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => (row[h] = vals[idx] || ""));
          rows.push(row);
        }
      } else {
        toast({ title: "Formato não suportado", description: "Use .xlsx, .xls ou .csv", variant: "destructive" });
        setImporting(false);
        return;
      }

      let imported = 0;
      for (const row of rows) {
        const name = row.name || row.nome || row["título"] || row.titulo || row.title || row["product name"] || row.produto || "";
        if (!name) continue;
        try {
          await createProduct.mutateAsync({
            name,
            description: row.description || row.descricao || row["descrição"] || null,
            sku: row.sku || row.ref || row["referência"] || row.referencia || row.codigo || row["código"] || null,
            cost: parseFloat(row.cost || row.custo || "0") || 0,
            price: parseFloat(row.price || row.preco || row["preço"] || row.pvp || "0") || 0,
            stock: parseInt(row.stock || row.estoque || row.qty || row.quantidade || "0") || 0,
            brand: row.brand || row.marca || null,
            supplier_url: row.supplier_url || row.url || row.fornecedor_url || null,
            status: "draft",
          });
          imported++;
        } catch {}
      }
      toast({ title: `${imported} produtos importados de ${file.name}!` });
    } catch (err: any) {
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    }
    setImporting(false);
    e.target.value = "";
  }, [createProduct, toast]);

  // PDF import
  const handlePdfImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith(".pdf")) return;

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

      if (!fullText.trim()) {
        toast({ title: "PDF vazio", variant: "destructive" });
        setImporting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("extract-products", { body: { text: fullText } });
      if (error) throw error;

      if (data.success && data.products?.length > 0) {
        let imported = 0;
        for (const p of data.products) {
          try {
            await createProduct.mutateAsync({
              name: p.name,
              description: p.description || null,
              sku: p.sku || null,
              cost: p.cost || 0,
              price: p.price || 0,
              stock: p.stock || 0,
              brand: p.brand || null,
              status: "draft",
            });
            imported++;
          } catch {}
        }
        toast({ title: `${imported} produtos importados do PDF!` });
      } else {
        toast({ title: "Nenhum produto encontrado no PDF", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao processar PDF", description: err.message, variant: "destructive" });
    }
    setImporting(false);
    e.target.value = "";
  }, [createProduct, toast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Catálogo</h1>
        <div className="flex gap-2">
          <label>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} disabled={importing} />
            <Button variant="outline" asChild disabled={importing}>
              <span>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Excel/CSV</span>
            </Button>
          </label>
          <label>
            <input type="file" accept=".pdf" className="hidden" onChange={handlePdfImport} disabled={importing} />
            <Button variant="outline" asChild disabled={importing}>
              <span><FileUp className="mr-2 h-4 w-4" />PDF</span>
            </Button>
          </label>
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

      <Tabs defaultValue="spreadsheet" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spreadsheet" className="gap-2"><Sheet className="h-4 w-4" />Planilha</TabsTrigger>
          <TabsTrigger value="sync">🔄 WooCommerce</TabsTrigger>
        </TabsList>

        <TabsContent value="spreadsheet">
          <Card>
            <CardHeader>
              <p className="text-xs text-muted-foreground">💡 Importe Excel/PDF e os produtos aparecem aqui. Duplo clique para editar. Use IA para enriquecer.</p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Carregando...</p>
              ) : products.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">Nenhum produto encontrado. Importe um ficheiro Excel ou PDF.</p>
              ) : (
                <SpreadsheetEditor products={products} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <WooCommerceSync />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductForm({
  product,
  categories,
  onSubmit,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  onSubmit: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "none");
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Salvando..." : product ? "Atualizar" : "Criar Produto"}
      </Button>
    </form>
  );
}
