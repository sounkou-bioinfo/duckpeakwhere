readme: README.md

README.md: README.Rmd test/fixtures/thymus-expected.json
	Rscript -e "rmarkdown::render('README.Rmd', output_format = 'github_document', quiet = TRUE)"
	rm -f README.html

.PHONY: readme
