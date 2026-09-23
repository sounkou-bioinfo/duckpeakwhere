readme: README.md

README.md: README.Rmd test/fixtures/thymus-expected.json benchmarks/results.json bench/report.R
	Rscript -e "rmarkdown::render('README.Rmd', output_format = 'github_document', quiet = TRUE)"
	rm -f README.html

performance: benchmarks/performance.md

benchmarks/performance.md: benchmarks/performance.Rmd benchmarks/results.json bench/report.R
	Rscript -e "rmarkdown::render('benchmarks/performance.Rmd', output_format = 'github_document', quiet = TRUE)"
	rm -f benchmarks/performance.html

.PHONY: readme performance
