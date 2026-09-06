# markitdown-web

Web para convertir archivos a Markdown con
[MarkItDown](https://github.com/microsoft/markitdown). El usuario sube un archivo, FastAPI lo
convierte y devuelve un `.md`. Un solo proceso sirve la API y el build de Astro.

## Las dos versiones

- **Sin OCR** (rama `main`, imagen `v1`). Solo MarkItDown: un PDF escaneado es una
  imagen y no da texto. La página lo dice así ("sin OCR ni IA").
- **Con OCR** (rama `integrar-OCR`, imagen `v2`, `ENABLE_OCR=1`). RapidOCR local: las
  imágenes entran como formato válido y un PDF escaneado pasa por OCR si MarkItDown lo
  devuelve vacío. Nada se descarga; el motor va dentro de la imagen.

  Trae cambios de la página que van con el flag: insignia **nuevo** en vez del punto del
  hero, fila **OCR** en los datos del encabezado, y "imágenes" pintado de azul en el
  medianil cuando el OCR sí las lee. La UI lee los límites y las frases de
  `GET /api/limits`, así que el texto nunca afirma un OCR que el servidor no aplica.

## Despliegue en Kubernetes (blue/green sobre minikube)

`k8s/manifest.yaml` define un Namespace (`mdconverter`), dos Deployments y un Service. Todo
queda en ese namespace:

- **blue** — `mdconverter:v1`, imagen de `main`, sin OCR. 2 réplicas.
- **green** — `mdconverter:v2`, imagen de `integrar-OCR`, con `ENABLE_OCR=1`. 2 réplicas.
- **web** — Service que manda el tráfico a una sola versión. Cambiás de color editando su
  `selector`; los pods no se tocan.

Ambos contenedores escuchan en el 8000. El Service publica el 80 y apunta al 8000.

### 1. Construir las dos imágenes

Cada versión sale de su rama. El `.` del final es el contexto de build. Necesitás el árbol
limpio (`git status`): si tenés cambios sin commitear en archivos que difieren entre ramas,
`git checkout` corta con «Aborting» y `docker build` te arma la imagen con la rama equivocada.

```bash
git checkout main         && docker build -t mdconverter:v1 .
git checkout integrar-OCR && docker build -t mdconverter:v2 .
git checkout main
```

### 2. Cargar las imágenes en minikube

minikube no ve el daemon local. Hay que meterle las imágenes.

```bash
minikube image load mdconverter:v1
minikube image load mdconverter:v2
```


### 3. Aplicar el manifest

El manifest trae el Namespace, así que `apply` lo crea y mete todo adentro:

```bash
kubectl apply -f k8s/manifest.yaml
kubectl rollout status deploy/mdconverter-blue -n mdconverter
kubectl rollout status deploy/mdconverter-green -n mdconverter
```

Si actualizaste una imagen con el mismo tag, los pods viejos siguen con la anterior. Forzá el
reemplazo:

```bash
kubectl delete pod -l app=web -n mdconverter
```

### 4. Probar cada versión

El `port-forward` de un Deployment va al puerto del contenedor (8000):

```bash
kubectl port-forward deploy/mdconverter-green 8080:8000 -n mdconverter
kubectl port-forward deploy/mdconverter-blue  8081:8000 -n mdconverter
```

A través del Service, el puerto es el 80:

```bash
kubectl port-forward svc/web 8080:80 -n mdconverter
```

### 5. Cambiar el tráfico

```bash
kubectl patch svc web -n mdconverter -p '{"spec":{"selector":{"version":"green"}}}'   # pasar a green
kubectl patch svc web -n mdconverter -p '{"spec":{"selector":{"version":"blue"}}}'    # volver a blue
```

### Bajar todo

```bash
kubectl delete -f k8s/manifest.yaml   # borra el namespace y todo lo que tiene adentro
```

## Referencias

- [MarkItDown](https://github.com/microsoft/markitdown) — el conversor.
- [RapidOCR](https://github.com/RapidAI/RapidOCR) — el motor de OCR local.
- [Kubernetes blue/green deployment](https://kubernetes.recipes/recipes/deployments/kubernetes-blue-green-deployment/) — base del manifest y el switch de tráfico.
