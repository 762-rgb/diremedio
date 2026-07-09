app.use(cors());
app.use(bodyParser.json());
// Serve static files from the same directory
app.use(express.static(__dirname));

// Forçar o carregamento do index.html na rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
