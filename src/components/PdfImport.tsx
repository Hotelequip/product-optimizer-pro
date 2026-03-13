import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileUp, Loader2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateProduct } from "@/hooks/useProducts";
import { supabase } from "@/integrations/supabase/client";

interface ExtractedProduct {
  name: string;
  description?: string;
  cost?: number;
  price?: number;
  stock?: number;
  selected: boolean;
}

export function PdfImport({ onDone }: { onDone?: () => void }) {
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [products, setProducts] = useState<ExtractedProduct[]>([]);
  const [fileName, setFileName] = useState("");
  const createProduct = useCreateProduct();
  const { toast } = useToast();

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n";
    }

    return fullText;
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".pdf")) {
      toast({ title: "Arquivo inválido", description: "Por favor, selecione um arquivo PDF.", variant: "destructive" });
      return;
    }

    setFileName(file.name);
    setExtracting(true);
    setProducts([]);

    try {
      const text = await extractTextFromPdf(file);

      if (!text.trim()) {
        toast({ title: "PDF vazio", description: "Não foi possível extrair texto do PDF.", variant: "destructive" });
        setExtracting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("extract-products", {
        body: { text },
      });

      if (error) throw error;

      if (data.success && data.products?.length > 0) {
        setProducts(data.products.map((p: any) => ({ ...p, selected: true })));
        toast({ title: `${data.products.length} produtos encontrados!` });
      } else {
        toast({ title: "Nenhum produto encontrado", description: data.error || "O PDF não contém dados de produtos identificáveis.", variant: "destructive" });
      }
    } catch (err: any) {
      console.error("PDF extraction error:", err);
      toast({ title: "Erro ao processar PDF", description: err.message, variant: "destructive" });
    } finally {
      setExtracting(false);
    }

    e.target.value = "";
  }, [toast]);

  const toggleProduct = (index: number) => {
    setProducts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, selected: !p.selected } : p))
    );
  };

  const toggleAll = () => {
    const allSelected = products.every((p) => p.selected);
    setProducts((prev) => prev.map((p) => ({ ...p, selected: !allSelected })));
  };

  const handleImport = async () => {
    const selected = products.filter((p) => p.selected);
    if (selected.length === 0) {
      toast({ title: "Nenhum produto selecionado", variant: "destructive" });
      return;
    }

    setImporting(true);
    let imported = 0;

    for (const p of selected) {
      try {
        await createProduct.mutateAsync({
          name: p.name,
          description: p.description || null,
          category_id: null,
          cost: p.cost || 0,
          price: p.price || 0,
          stock: p.stock || 0,
          status: "draft",
          image_url: null,
        });
        imported++;
      } catch {}
    }

    toast({ title: `${imported} produto${imported !== 1 ? "s" : ""} importado${imported !== 1 ? "s" : ""}!` });
    setProducts([]);
    setImporting(false);
    onDone?.();
  };

  const selectedCount = products.filter((p) => p.selected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileUp className="h-5 w-5" />
          Importar Produtos de PDF
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={extracting}
            />
            <Button variant="outline" asChild disabled={extracting}>
              <span>
                {extracting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processando...</>
                ) : (
                  <><FileUp className="mr-2 h-4 w-4" />Selecionar PDF</>
                )}
              </span>
            </Button>
          </label>
          {fileName && !extracting && (
            <span className="text-sm text-muted-foreground">{fileName}</span>
          )}
        </div>

        {extracting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Extraindo texto e analisando produtos com IA...
          </div>
        )}

        {products.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedCount} de {products.length} selecionados</Badge>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {products.every((p) => p.selected) ? "Desmarcar todos" : "Selecionar todos"}
                </Button>
              </div>
              <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
                {importing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importando...</>
                ) : (
                  <><Check className="mr-2 h-4 w-4" />Importar {selectedCount} produto{selectedCount !== 1 ? "s" : ""}</>
                )}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p, i) => (
                  <TableRow
                    key={i}
                    className={p.selected ? "" : "opacity-50"}
                    onClick={() => toggleProduct(i)}
                    style={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      {p.selected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {p.description || "—"}
                    </TableCell>
                    <TableCell>{p.cost != null ? `R$ ${p.cost.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{p.price != null ? `R$ ${p.price.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{p.stock != null ? p.stock : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
