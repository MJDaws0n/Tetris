
FROM httpd:2.4

# Remove default apache content
RUN rm -rf /usr/local/apache2/htdocs/*

# Copy our public files
COPY website/public/ /usr/local/apache2/htdocs/

# Copy .env for entrypoint.sh to use
COPY .env /usr/local/apache2/.env

# Copy entrypoint script
COPY website/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set entrypoint to update files before starting Apache
ENTRYPOINT ["/entrypoint.sh"]
CMD ["httpd-foreground"]
