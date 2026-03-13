import { useState } from "react";
import { useWooStores, WooStore } from "@/hooks/useWooStores";
import { useProducts, useCreateProduct } from "@/hooks/useProducts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, CheckCircle, XCircle, Wifi } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export function WooCommerceSync() {
  const { data: stores = [] } = useWooStores();
  const { data: products = [] } = useProducts();
  const createProduct = useCreateProduct();
  const { toast } = useToast();

  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; info?: any } | null>(null);
  const [importedProducts, setImportedProducts] = useState<any[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());
  const [selectedExports, setSelectedExports] = useState<Set<string>>(new Set());

  const activeStores = stores.filter(s => s.is_active);

  const testConnection = async () => {
    if (!selectedStoreId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { action: "test", store_id: selectedStoreId },
      });
      if (error) throw error;
      setTestResult(data);
      toast({ title: data.success ? "Conexão OK!" : "Falha na conexão", variant: data.success ? "default" : "destructive" });
    } catch (e: any) {
      setTestResult({ success: false });
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setTesting(false);
  };

  const importFromWoo = async () => {
    if (!selectedStoreId) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { action: "import", store_id: selectedStoreId },
      });
      if (error) throw error;
      if (data.success) {
        setImportedProducts(data.products || []);
        setSelectedImports(new Set(data.products.map((_: any, i: number) => i)));
        toast({ title: `${data.products.length} produtos encontrados no WooCommerce!` });
      } else {
        toast({ title: "Erro", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e.message, variant: "destructive" });
    }
    setImporting(false);
  };

  const confirmImport = async () => {
    let imported = 0;
    for (const idx of selectedImports) {
      const woo = importedProducts[idx];
      try {
        await createProduct.mutateAsync({
          name: woo.name,
          description: woo.description?.replace(/<[^>]*>/g, '') || null,
          category_id: null,
          cost: 0,
          price: parseFloat(woo.regular_price || woo.price || "0"),
          stock: woo.stock_quantity || 0,
          status: woo.status === "publish" ? "active" : "draft",
          image_url: woo.images?.[0]?.src || null,
        });
        imported++;
      } catch {}
    }
    toast({ title: `${imported} produtos importados!` });
    setImportedProducts([]);
    setSelectedImports(new Set());
  };

  const exportToWoo = async () => {
    if (!selectedStoreId || selectedExports.size === 0) return;
    setExporting(true);
    const toExport = products.filter(p => selectedExports.has(p.id));
    try {
      const { data, error } = await supabase.functions.invoke("woo-sync", {
        body: { action: "export", store_id: selectedStoreId, products: toExport },
      });
      if (error) throw error;
      if (data.success) {
        const total = data.results.reduce((acc: number, r: any) => acc + (r.created || 0), 0);
        toast({ title: `${total} produtos exportados para WooCommerce!` });
        setSelectedExports(new Set());
      } else {
        toast({ title: "Erro", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro na exportação", description: e.message, variant: "destructive" });
    }
    setExporting(false);
  };

  const toggleAllExports = () => {
    if (selectedExports.size === products.length) {
      setSelectedExports(new Set());
    } else {
      setSelectedExports(new Set(products.map(p => p.id)));
    }
  };

  if (activeStores.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>Configure uma loja WooCommerce primeiro na seção "WooCommerce" do menu.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Store Selection & Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sincronização WooCommerce</CardTitle>
          <CardDescription>Importe e exporte produtos entre o catálogo e suas lojas WooCommerce</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium">Loja</label>
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger className="w-[250px]"><SelectValue placeholder="Selecionar loja" /></SelectTrigger>
                <SelectContent>
                  {activeStores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={testConnection} disabled={!selectedStoreId || testing}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
              Testar Conexão
            </Button>
            {testResult && (
              <Badge variant={testResult.success ? "default" : "destructive"} className="gap-1">
                {testResult.success ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {testResult.success ? `WooCommerce ${testResult.info?.version}` : "Falhou"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowDownToLine className="h-5 w-5" />
                Importar do WooCommerce
              </CardTitle>
              <CardDescription>Buscar produtos da loja e importar para o catálogo</CardDescription>
            </div>
            <Button onClick={importFromWoo} disabled={!selectedStoreId || importing}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownToLine className="mr-2 h-4 w-4" />}
              Buscar Produtos
            </Button>
          </div>
        </CardHeader>
        {importedProducts.length > 0 && (
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{selectedImports.size} de {importedProducts.length} selecionados</p>
                <Button onClick={confirmImport} disabled={selectedImports.size === 0}>
                  Importar Selecionados
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedImports.size === importedProducts.length}
                          onCheckedChange={() => {
                            if (selectedImports.size === importedProducts.length) setSelectedImports(new Set());
                            else setSelectedImports(new Set(importedProducts.map((_, i) => i)));
                          }}
                        />
                      </TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead>Estoque</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importedProducts.slice(0, 50).map((woo, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Checkbox
                            checked={selectedImports.has(i)}
                            onCheckedChange={() => {
                              const next = new Set(selectedImports);
                              next.has(i) ? next.delete(i) : next.add(i);
                              setSelectedImports(next);
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">{woo.name}</TableCell>
                        <TableCell className="text-sm">R$ {parseFloat(woo.regular_price || woo.price || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{woo.stock_quantity ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={woo.status === "publish" ? "default" : "secondary"} className="text-[10px]">
                            {woo.status === "publish" ? "Publicado" : woo.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowUpFromLine className="h-5 w-5" />
                Exportar para WooCommerce
              </CardTitle>
              <CardDescription>Enviar produtos do catálogo para a loja selecionada</CardDescription>
            </div>
            <Button onClick={exportToWoo} disabled={!selectedStoreId || exporting || selectedExports.size === 0}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpFromLine className="mr-2 h-4 w-4" />}
              Exportar ({selectedExports.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum produto no catálogo</p>
          ) : (
            <div className="max-h-64 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={selectedExports.size === products.length} onCheckedChange={toggleAllExports} />
                    </TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedExports.has(p.id)}
                          onCheckedChange={() => {
                            const next = new Set(selectedExports);
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                            setSelectedExports(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm">R$ {Number(p.price).toFixed(2)}</TableCell>
                      <TableCell className="text-sm">{p.stock}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-[10px]">
                          {p.status === "active" ? "Ativo" : p.status === "inactive" ? "Inativo" : "Rascunho"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
