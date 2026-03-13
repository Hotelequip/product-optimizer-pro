import { useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";

export default function Analysis() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Análise</h1>
      <Tabs defaultValue="compare">
        <TabsList>
          <TabsTrigger value="compare">Comparação</TabsTrigger>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
          <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
        </TabsList>
        <TabsContent value="compare"><CompareTab /></TabsContent>
        <TabsContent value="ranking"><RankingTab /></TabsContent>
        <TabsContent value="opportunities"><OpportunitiesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CompareTab() {
  const { data: products = [] } = useProducts();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const compared = products.filter((p) => selected.includes(p.id));

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">Selecione Produtos para Comparar</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-48 overflow-auto">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {compared.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Margem</TableHead>
                  <TableHead>Estoque</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compared.map((p) => {
                  const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>R$ {Number(p.cost).toFixed(2)}</TableCell>
                      <TableCell>R$ {Number(p.price).toFixed(2)}</TableCell>
                      <TableCell>{margin.toFixed(1)}%</TableCell>
                      <TableCell>{p.stock}</TableCell>
                      <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RankingTab() {
  const { data: products = [] } = useProducts();
  const [sortBy, setSortBy] = useState<"margin" | "price" | "stock">("margin");

  const sorted = [...products].sort((a, b) => {
    if (sortBy === "margin") {
      const ma = a.cost > 0 ? (a.price - a.cost) / a.cost : 0;
      const mb = b.cost > 0 ? (b.price - b.cost) / b.cost : 0;
      return mb - ma;
    }
    if (sortBy === "price") return Number(b.price) - Number(a.price);
    return b.stock - a.stock;
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex gap-3 items-end">
        <div className="space-y-2">
          <Label>Ordenar por</Label>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="margin">Margem</SelectItem>
              <SelectItem value="price">Preço</SelectItem>
              <SelectItem value="stock">Estoque</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        <CardContent className="pt-6">
          {sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhum produto</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Margem</TableHead>
                  <TableHead>Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p, i) => {
                  const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>R$ {Number(p.cost).toFixed(2)}</TableCell>
                      <TableCell>R$ {Number(p.price).toFixed(2)}</TableCell>
                      <TableCell>{margin.toFixed(1)}%</TableCell>
                      <TableCell>{p.stock}</TableCell>
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

function OpportunitiesTab() {
  const { data: products = [] } = useProducts();
  const [targetMargin, setTargetMargin] = useState("30");

  const target = parseFloat(targetMargin) || 0;
  const belowTarget = products
    .filter((p) => {
      const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
      return margin < target && p.status === "active";
    })
    .sort((a, b) => {
      const ma = a.cost > 0 ? ((a.price - a.cost) / a.cost) * 100 : 0;
      const mb = b.cost > 0 ? ((b.price - b.cost) / b.cost) * 100 : 0;
      return ma - mb;
    });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex gap-3 items-end">
        <div className="space-y-2">
          <Label>Meta de Margem (%)</Label>
          <Input type="number" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} className="w-32" />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {belowTarget.length} produto{belowTarget.length !== 1 && "s"} abaixo da meta de {target}%
          </CardTitle>
        </CardHeader>
        <CardContent>
          {belowTarget.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Todos os produtos atendem à meta 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Preço Atual</TableHead>
                  <TableHead>Margem Atual</TableHead>
                  <TableHead>Preço Sugerido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {belowTarget.map((p) => {
                  const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
                  const suggestedPrice = p.cost * (1 + target / 100);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>R$ {Number(p.cost).toFixed(2)}</TableCell>
                      <TableCell>R$ {Number(p.price).toFixed(2)}</TableCell>
                      <TableCell className="text-destructive">{margin.toFixed(1)}%</TableCell>
                      <TableCell className="font-medium">R$ {suggestedPrice.toFixed(2)}</TableCell>
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
