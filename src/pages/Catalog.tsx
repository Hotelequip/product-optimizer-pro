import { useState } from "react";
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, Product } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Search, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = { active: "Ativo", inactive: "Inativo", draft: "Rascunho" };
const statusVariants: Record<string, "default" | "secondary" | "outline"> = { active: "default", inactive: "secondary", draft: "outline" };

export default function Catalog() {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const filtered = products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterCategory !== "all" && p.category_id !== filterCategory) return false;
    return true;
  });

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map((v) => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => (row[h] = vals[idx] || ""));
        try {
          await createProduct.mutateAsync({
            name: row.name || row.nome || `Produto ${i}`,
            description: row.description || row.descricao || null,
            category_id: null,
            cost: parseFloat(row.cost || row.custo || "0"),
            price: parseFloat(row.price || row.preco || "0"),
            stock: parseInt(row.stock || row.estoque || "0"),
            status: "draft",
            image_url: null,
          });
          imported++;
        } catch {}
      }
      toast({ title: `${imported} produtos importados!` });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Catálogo</h1>
        <div className="flex gap-2">
          <label>
            <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
            <Button variant="outline" asChild>
              <span><Upload className="mr-2 h-4 w-4" />Importar CSV</span>
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">Nenhum produto encontrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Margem</TableHead>
                  <TableHead>Estoque</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>R$ {Number(p.cost).toFixed(2)}</TableCell>
                      <TableCell>R$ {Number(p.price).toFixed(2)}</TableCell>
                      <TableCell className={margin < 0 ? "text-destructive" : ""}>{margin.toFixed(1)}%</TableCell>
                      <TableCell className={p.stock < 10 ? "text-destructive font-medium" : ""}>{p.stock}</TableCell>
                      <TableCell><Badge variant={statusVariants[p.status]}>{statusLabels[p.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingProduct(p); setDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteProduct.mutate(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
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
              <SelectItem value="draft">Rascunho</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
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
