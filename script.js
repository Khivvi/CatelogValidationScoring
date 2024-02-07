$(document).ready(function() {
    $('.custom-file-input').on('change', function() {
        let fileName = $(this).val().split('\\').pop();
        $(this).next('.custom-file-label').addClass("selected").html(fileName);
    });

    $('#uploadButton').click(function() {
        var formData = new FormData($('#uploadForm')[0]);

        $.ajax({
            url: '/upload',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            beforeSend: function() {
                $('#validationResult').hide();
                $('#errorList').hide().empty();
            },
            success: function(data) {
                $('#validationResult')
                    .show()
                    .removeClass('alert-danger')
                    .addClass('alert-success')
                    .text(data.message);
                if (!data.isValid && data.validationErrors && data.validationErrors.length > 0) {
                    displayErrors(data.validationErrors);
                }
            },
            error: function(xhr) {
                $('#validationResult')
                    .show()
                    .removeClass('alert-success')
                    .addClass('alert-danger')
                    .text('Upload failed: ' + xhr.responseText);
            }
        });
    });

    function displayErrors(errors) {
        const errorList = $('#errorList');
        errorList.empty(); // Ensure to clear previous errors
    
        // Log errors to console for debugging
        console.log('Errors received:', errors);
    
        errors.forEach(function(error) {
            if (error.row && error.errors) {
                error.errors.forEach(function(err) {
                    errorList.append($('<li>').text(`Row ${error.row}: ${err}`));
                });
            } else if (typeof error === 'object') {
                // If the error is an object, convert it to a JSON string for display
                errorList.append($('<li>').text(JSON.stringify(error, null, 4)));
            } else {
                // If the error is a string, display it directly
                errorList.append($('<li>').text(error));
            }
        });
    
        errorList.show();
    }
    
    
});
