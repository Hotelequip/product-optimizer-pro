import { useState } from "react";
import { usePriceRules, useCreatePriceRule, useDeletePriceRule } from "@/hooks/usePriceRules";
import { useProducts, useUpdateProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Pricing() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Automação de Preços</h1>
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="simulator">Simulador</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="rules"><PriceRulesTab /></TabsContent>
        <TabsContent value="simulator"><SimulatorTab /></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function PriceRulesTab() {
  const { data: rules = [] } = usePriceRules();
  const { data: categories = [] } = useCategories();
  const createRule = useCreatePriceRule();
  const deleteRule = useDeletePriceRule();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("none");
  const [markup, setMarkup] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [rounding, setRounding] = useState("none");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createRule.mutateAsync({
      name,
      category_id: categoryId === "none" ? null : categoryId,
      markup_percent: markup ? parseFloat(markup) : null,
      min_margin_percent: minMargin ? parseFloat(minMargin) : null,
      rounding,
      is_active: true,
    });
    setName("");
    setMarkup("");
    setMinMargin("");
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">Nova Regra</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Todas</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Markup (%)</Label>
              <Input type="number" step="0.1" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Margem mín. (%)</Label>
              <Input type="number" step="0.1" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Arredondamento</Label>
              <Select value={rounding} onValueChange={setRounding}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  <SelectItem value="up">Para cima</SelectItem>
                  <SelectItem value="down">Para baixo</SelectItem>
                  <SelectItem value="nearest">Mais próximo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={createRule.isPending}><Plus className="mr-2 h-4 w-4" />Criar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {rules.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhuma regra criada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Markup</TableHead>
                  <TableHead>Margem Mín.</TableHead>
                  <TableHead>Arredondamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.markup_percent != null ? `${r.markup_percent}%` : "—"}</TableCell>
                    <TableCell>{r.min_margin_percent != null ? `${r.min_margin_percent}%` : "—"}</TableCell>
                    <TableCell>{r.rounding}</TableCell>
                    <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Ativa" : "Inativa"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteRule.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SimulatorTab() {
  const { data: products = [] } = useProducts();
  const { data: categories = [] } = useCategories();
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();

  const [categoryId, setCategoryId] = useState("all");
  const [adjustType, setAdjustType] = useState("markup");
  const [adjustValue, setAdjustValue] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string; oldPrice: number; newPrice: number }[]>([]);

  const targetProducts = categoryId === "all" ? products : products.filter((p) => p.category_id === categoryId);

  const simulate = () => {
    const val = parseFloat(adjustValue) || 0;
    const result = targetProducts.map((p) => {
      let newPrice = p.price;
      if (adjustType === "markup") newPrice = p.cost * (1 + val / 100);
      else if (adjustType === "percent") newPrice = p.price * (1 + val / 100);
      else if (adjustType === "fixed") newPrice = p.price + val;
      return { id: p.id, name: p.name, oldPrice: Number(p.price), newPrice: Math.max(0, parseFloat(newPrice.toFixed(2))) };
    });
    setPreview(result);
  };

  const apply = async () => {
    for (const item of preview) {
      if (item.oldPrice !== item.newPrice) {
        await updateProduct.mutateAsync({ id: item.id, price: item.newPrice });
      }
    }
    toast({ title: `${preview.length} preços atualizados!` });
    setPreview([]);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">Simulador de Preços</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={adjustType} onValueChange={setAdjustType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="markup">Markup sobre custo</SelectItem>
                  <SelectItem value="percent">% sobre preço atual</SelectItem>
                  <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={adjustValue} onChange={(e) => setAdjustValue(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={simulate}><Play className="mr-2 h-4 w-4" />Simular</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {preview.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Preview ({preview.length} produtos)</CardTitle>
            <Button onClick={apply}>Aplicar Preços</Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Preço Atual</TableHead>
                  <TableHead>Novo Preço</TableHead>
                  <TableHead>Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>R$ {item.oldPrice.toFixed(2)}</TableCell>
                    <TableCell>R$ {item.newPrice.toFixed(2)}</TableCell>
                    <TableCell className={item.newPrice > item.oldPrice ? "text-green-600" : item.newPrice < item.oldPrice ? "text-destructive" : ""}>
                      {item.newPrice > item.oldPrice ? "+" : ""}R$ {(item.newPrice - item.oldPrice).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data: history = [] } = usePriceHistory();
  const { data: products = [] } = useProducts();

  const getName = (productId: string) => products.find((p) => p.id === productId)?.name || "—";

  return (
    <div className="mt-4">
      <Card>
        <CardContent className="pt-6">
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhuma alteração de preço registrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Preço Anterior</TableHead>
                  <TableHead>Novo Preço</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{getName(h.product_id)}</TableCell>
                    <TableCell>R$ {Number(h.old_price).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(h.new_price).toFixed(2)}</TableCell>
                    <TableCell>{new Date(h.changed_at).toLocaleDateString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
