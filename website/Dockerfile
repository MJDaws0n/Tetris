FROM httpd:2.4

# Remove default apache content
RUN rm -rf /usr/local/apache2/htdocs/*

# Copy our public files
COPY ./public/ /usr/local/apache2/htdocs/
