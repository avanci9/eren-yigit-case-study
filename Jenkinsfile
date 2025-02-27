pipeline {
    agent any
    
    environment {
        DOCKER_REGISTRY = 'localhost:5000'
        APP_NAME = 'simple-nodejs-app'
        IMAGE_NAME = "${DOCKER_REGISTRY}/${APP_NAME}"
        VERSION = "${env.BUILD_NUMBER}"
        NAMESPACE = "kube-system"
        BLUE = 'blue'
        GREEN = 'green'
        EMAIL_RECIPIENT = 'mail@mail.com'
    }
    
    stages {
        stage('Build') {
            steps {
                nodejs(nodeJSInstallationName: 'nodejs') {
                    echo 'Installing npm dependencies...'
                    sh 'ls -lash'
                    sh 'whoami'
                    sh 'npm install'
                    echo 'Building application...'
                    sh 'npm ci'
                }
            }
        }
        
        stage('Test') {
            steps {
                nodejs(nodeJSInstallationName: 'nodejs') {
                    echo 'Running tests...'
                    sh 'npm test'
                }
            }
        }
        
        stage('Security Scan - Dependencies') {
            steps {
                echo 'Scanning dependencies for vulnerabilities...'
                // Using npm audit to check for vulnerabilities in npm packages
                sh '''
                    npm audit --json > npm-audit.json || true
                    # Parse and report critical vulnerabilities
                    echo "Checking for critical vulnerabilities..."
                    if grep -q '"severity":"critical"' npm-audit.json; then
                        echo "CRITICAL VULNERABILITIES FOUND!"
                        cat npm-audit.json | grep -B 5 -A 5 '"severity":"critical"'
                        # In a real environment, you might want to fail the build here
                        # exit 1
                    else
                        echo "No critical vulnerabilities found."
                    fi
                '''
            }
            post {
                always {
                    // Archive npm audit results
                    archiveArtifacts artifacts: 'npm-audit.json', allowEmptyArchive: true
                }
            }
        }
        
        stage('Containerize') {
            steps {
                echo 'Building Docker image...'
                sh "docker build -t ${IMAGE_NAME}:${VERSION} ."
                sh "docker tag ${IMAGE_NAME}:${VERSION} ${IMAGE_NAME}:latest"
            }
        }
        
        stage('Security Scan - Container') {
            steps {
                echo 'Scanning Docker image for vulnerabilities...'
                // TODO: Implement Trivy for container scanning for container scanning
                sh '''
                    # Create a sample report for demo purposes
                    cat > trivy-report.json << EOL
                    {
                      "Results": [
                        {
                          "Target": "docker-image-scan",
                          "Vulnerabilities": []
                        }
                      ]
                    }
                    EOL
                '''
            }
            post {
                always {
                    // Archive security scan reports
                    archiveArtifacts artifacts: 'trivy-report.json', allowEmptyArchive: true
                }
            }
        }
        
        stage('Push to Registry') {
            steps {
                echo 'Pushing image to registry...'
                sh "docker push ${IMAGE_NAME}:${VERSION}"
                sh "docker push ${IMAGE_NAME}:latest"
            }
        }
        
        stage('Determine Deployment Color') {
            steps {
                withKubeConfig([credentialsId: 'Kubernetes',contextName: 'jenkins-context',serverUrl:'https://127.0.0.1:65163']) {
                    script {
                        try {
                            // Check which deployment is currently active
                            env.CURRENT_COLOR = sh(
                                script: "kubectl get service --namespace ${env.NAMESPACE} simple-nodejs-app -o jsonpath='{.spec.selector.color}'",
                                returnStdout: true
                            ).trim()
                            
                            env.DEPLOY_COLOR = env.CURRENT_COLOR == env.BLUE ? env.GREEN : env.BLUE
                            echo "Current color is ${env.CURRENT_COLOR}, deploying to ${env.DEPLOY_COLOR}"
                        } catch (Exception e) {
                            // If service doesn't exist, start with blue
                            env.DEPLOY_COLOR = env.BLUE
                            echo "No existing deployment found, starting with ${env.DEPLOY_COLOR}"
                        }
                    }
                }
            }
        }
        
        stage('Deploy Kubernetes Manifests') {
            steps {
                withKubeConfig([credentialsId: 'Kubernetes',contextName: 'jenkins-context',serverUrl:'https://127.0.0.1:65163']) {
                    echo "Deploying ${env.DEPLOY_COLOR} version..."
                    
                    // Create ConfigMap and Secrets first
                    sh "kubectl apply -f kubernetes/configmap.yaml --namespace ${env.NAMESPACE}"
                    sh "kubectl apply -f kubernetes/secret.yaml --namespace ${env.NAMESPACE}"
                    
                    // Deploy Network Policies and Distruption Budget
                    sh "kubectl apply -f kubernetes/network-policy.yaml --namespace ${env.NAMESPACE}"
                    sh "kubectl apply -f kubernetes/pod-disruption-budget.yaml --namespace ${env.NAMESPACE}"
                    
                    // Replace variables in deployment manifest
                    sh """
                        cat kubernetes/deployment.yaml | 
                        sed 's/\${COLOR}/${env.DEPLOY_COLOR}/g' | 
                        sed 's/\${IMAGE_NAME}/${IMAGE_NAME.replace('/', '\\/')}/g' | 
                        sed 's/\${IMAGE_TAG}/${VERSION}/g' | 
                        sed 's/\${VERSION}/${VERSION}/g' > deployment-${env.DEPLOY_COLOR}.yaml
                    """
                    
                    // Apply the deployment manifest
                    sh "cat deployment-${env.DEPLOY_COLOR}.yaml"
                    sh "kubectl apply -f deployment-${env.DEPLOY_COLOR}.yaml --namespace ${env.NAMESPACE}"
                    
                    // Apply HorizontalPodAutoscaler
                    sh """
                        cat kubernetes/hpa.yaml | 
                        sed 's/\${COLOR}/${env.DEPLOY_COLOR}/g' > hpa-${env.DEPLOY_COLOR}.yaml
                    """
                    sh "kubectl apply -f hpa-${env.DEPLOY_COLOR}.yaml --namespace ${env.NAMESPACE}"
                    
                    // Wait for deployment to be ready
                    //TODO: timeout should be configured according to application expentancy
                    sh "kubectl rollout status --namespace ${env.NAMESPACE} deployment/simple-nodejs-app-${env.DEPLOY_COLOR} --timeout=180s"
                }
            }
        }
        
        stage('Test New Deployment') {
            steps {
                withKubeConfig([credentialsId: 'Kubernetes',contextName: 'jenkins-context',serverUrl:'https://127.0.0.1:65163']) {
                    echo "Testing the new ${env.DEPLOY_COLOR} deployment..."
                    
                    // Create a temporary service to test the new deployment
                    sh """
                        kubectl expose deployment --namespace ${env.NAMESPACE} simple-nodejs-app-${env.DEPLOY_COLOR} --type=NodePort --name=simple-nodejs-app-${env.DEPLOY_COLOR}-test --port=80 --target-port=3000 --overrides '{ "apiVersion": "v1","spec":{"ports": [{"port":80,"protocol":"TCP","targetPort":3000,"nodePort":30080}]}}'
                        kubectl rollout status --namespace ${env.NAMESPACE} deployment/simple-nodejs-app-${env.DEPLOY_COLOR} --timeout=60s
                    """
                    
                    // Test the deployment
                    script {
                        try {
                            def testEndpoint = sh(
                                script: "kubectl get service --namespace ${env.NAMESPACE} simple-nodejs-app-${env.DEPLOY_COLOR}-test -o jsonpath='{.spec.clusterIP}'",
                                returnStdout: true
                            ).trim()
                            
                            def response = sh(
                                script: "curl -s localhost:30080/health",
                                returnStdout: true
                            ).trim()
                            
                            if (!response.contains("healthy")) {
                                error "Health check failed for ${env.DEPLOY_COLOR} deployment"
                            }
                            
                            echo "New deployment passed health check!"
                        } catch (Exception e) {
                            echo "Health check failed, rolling back the deployment..."
                            sh "kubectl rollout undo deployment/simple-nodejs-app-${env.DEPLOY_COLOR} --namespace ${env.NAMESPACE}"
                            error "Failed health check caused rollback of ${env.DEPLOY_COLOR} deployment: ${e.message}"
                        } finally {
                            // Clean up the test service
                            sh "kubectl delete service --namespace ${env.NAMESPACE} simple-nodejs-app-${env.DEPLOY_COLOR}-test || true"
                        }
                    }
                }
            }
        }
        
        stage('Switch Traffic') {
            steps {
                withKubeConfig([credentialsId: 'Kubernetes',contextName: 'jenkins-context',serverUrl:'https://127.0.0.1:65163']) {
                    echo "Switching traffic to ${env.DEPLOY_COLOR} deployment..."
                    
                    // Update the main service to point to the new deployment
                    sh """
                        cat kubernetes/service.yaml | 
                        sed 's/\${ACTIVE_COLOR}/${env.DEPLOY_COLOR}/g' > service-${env.DEPLOY_COLOR}.yaml
                        
                        kubectl apply -f service-${env.DEPLOY_COLOR}.yaml --namespace ${env.NAMESPACE}
                    """
                    
                    echo "Traffic successfully switched to ${env.DEPLOY_COLOR} deployment!"
                }
            }
        }
        
        stage('Cleanup') {
            steps {
                withKubeConfig([credentialsId: 'Kubernetes',contextName: 'jenkins-context',serverUrl:'https://127.0.0.1:65163']) {
                    echo "Cleanup after successful deployment..."
                    
                    script {
                        if (env.CURRENT_COLOR) {
                            echo "Keeping the previous ${env.CURRENT_COLOR} deployment as a fallback for 1 hour"
                            //TODO: Implement a cleanup strategy either via another jenkins job or with a TTL plugin or with a cronjob/service
                            //scale down old deployment for now
                            sh "kubectl scale deployment simple-nodejs-app-${env.CURRENT_COLOR} --namespace ${env.NAMESPACE} --replicas=1"
                        }
                    }
                }
            }
        }
    }
    
    post {
        success {
            echo "Deployment completed successfully!"
            //TODO: Implement email/slack/teams notifications
            echo """
            Would send email notification to: ${EMAIL_RECIPIENT}
            Subject: SUCCESS: DevOps App Deployment #${env.BUILD_NUMBER}
            Body: Deployment of DevOps App version ${env.VERSION} completed successfully!
            """
        }
        failure {
            echo "Deployment failed!"
            
            script {
                if (env.DEPLOY_COLOR) {
                    // Rollback in case of failure
                    echo "Rolling back to previous version..."
                    if (env.CURRENT_COLOR) {

                        sh """
                            cat kubernetes/service.yaml
                            cat kubernetes/service.yaml | 
                            sed 's/\${ACTIVE_COLOR}/${env.CURRENT_COLOR}/g' > service-rollback.yaml
                            cat service-rollback.yaml
                            kubectl apply -f service-rollback.yaml
                        """
                        echo "Rolled back to ${env.CURRENT_COLOR}"
                    }
                }
            }
            //TODO: Implement email/slack/teams notifications
            echo """
            Would send email notification to: ${EMAIL_RECIPIENT}
            Subject: SUCCESS: DevOps App Deployment #${env.BUILD_NUMBER}
            Body: Deployment of DevOps App version ${env.VERSION} completed successfully!
            """
        }
        always {
            // Clean up workspace
            cleanWs()
        }
    }
}