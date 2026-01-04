# Code Typing Practice (Programming-oriented)

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
bash run.sh
```

Open: http://localhost:8000

## Sources

Put C source files in `./sources` (currently expects `.c` and `.h`). The app will pick random chunks to type.



TODOS:
 - incorrect ESP key shows on onscreen keyboard while pressing keys
 - visually improve the popup boxes
 - improve the sentences and group mappings -> likely can use LLM to generate sentences and group mappings.
   - LLM generation didn't work very well.
   - Try feeding sp_en.txt to llm for word groups
   - have it filter out negative phrases
   - I tried this -> the group mappings produced were incorrect.